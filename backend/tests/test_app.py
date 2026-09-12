from copy import deepcopy
from decimal import Decimal
from zipfile import ZipFile
from lxml import etree as E
import pytest
from app.schemas import Item, Specification, validate_generation, totals
from app.documents import generate_docx, TEMPLATES, template_info

NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
def texts(path):
    with ZipFile(path) as z:
        return '\n'.join(E.fromstring(z.read('word/document.xml')).xpath('//w:t/text()',namespaces=NS))

def test_private_api_and_csrf(client):
    for path in ['/api/contracts','/api/profile','/api/contracts/missing','/api/issues/missing/files/docx']:
        assert client.get(path).status_code==401
    assert client.post('/api/login',headers={'X-Pact-Request':''},json={'username':'admin','password':'test-password-long'}).status_code==403
    assert client.post('/api/login',headers={'Origin':'https://evil.invalid'},json={'username':'admin','password':'test-password-long'}).status_code==403
    assert client.post('/api/login',json={'username':'admin','password':'wrong'}).status_code==401
    response=client.post('/api/login',json={'username':'admin','password':'test-password-long'})
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie']
    assert client.post('/api/logout').status_code==200
    assert client.get('/api/profile').status_code==401

def test_rate_limit(client):
    for _ in range(10): assert client.post('/api/login',json={'username':'admin','password':'wrong'}).status_code==401
    assert client.post('/api/login',json={'username':'admin','password':'test-password-long'}).status_code==429

def test_autosave_conflict_search_copy(logged,contract):
    c=logged.post('/api/contracts',json=contract.model_dump()).json()
    partial=deepcopy(c['data']); partial['number']='Новый-номер';partial['customer']['inn']=''
    updated=logged.put('/api/contracts/'+c['id'],json={'revision':0,'data':partial})
    assert updated.status_code==200
    assert logged.put('/api/contracts/'+c['id'],json={'revision':0,'data':c['data']}).status_code==409
    assert logged.get('/api/contracts/'+c['id']).json()['data']['number']=='Новый-номер'
    assert len(logged.get('/api/contracts?q=Новый-номер').json())==1
    assert len(logged.get('/api/contracts?q=заказчик').json())==1
    assert len(logged.get('/api/contracts?q=%25').json())==0
    copied=logged.post('/api/contracts/'+c['id']+'/copy').json()
    assert copied['id']!=c['id'] and copied['number']=='' and copied['date']=='' and copied['issues']==[]
    assert copied['data']['customer']==partial['customer']

def test_profile_verification_and_conflict(logged,supplier):
    profile=logged.get('/api/profile').json()
    assert not profile['profile']['verified'] and profile['source_notes']
    invalid=supplier.model_copy(deep=True);invalid.party.inn='123'
    assert logged.put('/api/profile',json=invalid.model_dump()).status_code==422
    assert logged.put('/api/profile',json=supplier.model_dump()).status_code==200
    assert logged.put('/api/profile',json=supplier.model_dump()).status_code==409

def test_exact_money_and_validation(contract,supplier):
    spec=Specification(items=[Item(quantity='0,5',price='0,01'),Item(quantity='0.5',price='0.01')])
    assert totals(spec)==([Decimal('0.01'),Decimal('0.01')],Decimal('0.02'))
    assert not validate_generation(contract,supplier)
    for bad in ['NaN','Infinity','-1','1e5','0','1.0001']:
        contract.specification.items[0].quantity=bad
        assert 'specification.items.0.quantity' in validate_generation(contract,supplier)
    contract.specification.items[0].quantity='1'
    contract.specification.items[0].price='1.001'
    assert 'specification.items.0.price' in validate_generation(contract,supplier)
    contract.date='2026-02-30'
    assert 'date' in validate_generation(contract,supplier)

@pytest.mark.parametrize('kind',['simple','full'])
@pytest.mark.parametrize('customer_kind',['company','ip'])
def test_documents_preserve_terms_and_replace_all_slots(tmp_path,contract,supplier,kind,customer_kind):
    contract.type=kind
    if customer_kind=='ip':
        p=contract.customer;p.kind='ip';p.full_name='Индивидуальный предприниматель Петров Пётр Петрович';p.short_name='ИП Петров П.П.';p.representative=False;p.signature='Петров П.П.';p.inn='123456789012';p.registration='123456789012345'
    output=tmp_path/'out.docx';generate_docx(contract,supplier,output)
    text=texts(output)
    for old in ['УКЦПиМС','Университетский','Богачкин','МЕДИКАЛ','Вардапетян','kosogovstom','190\u00a0000','{{']:
        assert old not in text
    assert contract.number in text and contract.customer.full_name in text and contract.customer.signature in text
    if kind=='full':
        assert text.count(contract.number)==2
        assert '5\u00a0586,43' in text
        assert 'Zumax' not in text
    original=TEMPLATES/'source'/f'{kind}.docx'
    with ZipFile(original) as z:
        source=E.fromstring(z.read('word/document.xml'))
        ps=source.xpath('/w:document/w:body/w:p',namespaces=NS)
        paragraphs=ps[7:98] if kind=='full' else ps[5:28]
        for p in paragraphs:
            value=''.join(p.xpath('.//w:t/text()',namespaces=NS))
            if value.strip() and not (kind=='simple' and 'Срок полной оплаты' in value):
                with ZipFile(output) as generated:
                    outroot=E.fromstring(generated.read('word/document.xml'))
                    assert E.tostring(p) in [E.tostring(x) for x in outroot.xpath('/w:document/w:body/w:p',namespaces=NS)]
    with ZipFile(TEMPLATES/template_info(kind)['file']) as z,ZipFile(output) as out:
        for name in z.namelist():
            if name!='word/document.xml': assert z.read(name)==out.read(name)

def test_literal_xml_and_template_input(tmp_path,contract,supplier):
    contract.specification.items[0].name='Пример & <изделие> {{number}}'
    contract.customer.full_name='ООО «Тест & <проверка> {{supplier_inn}}»'
    generate_docx(contract,supplier,tmp_path/'literal.docx')
    content=texts(tmp_path/'literal.docx')
    assert contract.specification.items[0].name in content
    assert contract.customer.full_name in content

def test_generation_snapshot_idempotency_pdf_failure_retry(logged,contract,supplier,monkeypatch):
    import app.main as main
    assert logged.put('/api/profile',json=supplier.model_dump()).status_code==200
    c=logged.post('/api/contracts',json=contract.model_dump()).json()
    def fail(*args): raise RuntimeError('converter unavailable')
    monkeypatch.setattr(main,'convert_pdf',fail)
    req={'revision':0,'request_id':'test-request-id-12345'}
    issue=logged.post('/api/contracts/'+c['id']+'/generate',json=req).json()
    assert issue['status']=='pdf_failed' and issue['has_docx']
    original=logged.get(f'/api/issues/{issue["id"]}/files/docx').content
    assert logged.get(f'/api/issues/{issue["id"]}/files/pdf').status_code==404
    repeated=logged.post('/api/contracts/'+c['id']+'/generate',json=req).json()
    assert repeated['id']==issue['id']
    supplier.revision=1;supplier.party.short_name='ИП Изменённый'
    assert logged.put('/api/profile',json=supplier.model_dump()).status_code==200
    assert logged.get(f'/api/issues/{issue["id"]}/files/docx').content==original
    def pdf(docx,target): target.write_bytes(b'%PDF-test')
    monkeypatch.setattr(main,'convert_pdf',pdf)
    retried=logged.post(f'/api/issues/{issue["id"]}/retry-pdf').json()
    assert retried['status']=='ready' and retried['has_pdf']
    assert logged.get(f'/api/issues/{issue["id"]}/files/pdf').content==b'%PDF-test'

def test_generation_rejects_incomplete(logged):
    c=logged.post('/api/contracts',json={'type':'simple'}).json()
    response=logged.post('/api/contracts/'+c['id']+'/generate',json={'revision':0,'request_id':'test-incomplete-12345'})
    assert response.status_code==422 and 'supplier.verified' in response.json()['detail']['fields']
