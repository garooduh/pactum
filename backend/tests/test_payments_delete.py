import uuid
from zipfile import ZipFile
import pytest
from lxml import etree as E
from app.schemas import payment_percent,validate_generation
from app.documents import generate_docx,party_values

@pytest.mark.parametrize('value', ['-1','101','1.5','abc',''])
def test_invalid_percent(value,contract,supplier):
    contract.prepayment_percent=value
    assert 'prepayment_percent' in validate_generation(contract,supplier)

@pytest.mark.parametrize('kind', ['simple','full'])
@pytest.mark.parametrize('percent', ['0','30','50','100'])
def test_payment_in_document(kind,percent,tmp_path,contract,supplier):
    contract.type=kind;contract.prepayment_percent=percent
    contract.balance_terms='в течение 7 дней после поставки'
    path=tmp_path/'contract.docx';generate_docx(contract,supplier,path)
    with ZipFile(path) as z:
        root=E.fromstring(z.read('word/document.xml'))
        text=''.join(root.itertext())
        assert '{{payment_terms}}' not in text
        if percent=='0': assert 'без предоплаты' in text
        else: assert percent+'%' in text
        if percent!='100':
            assert str(100-int(percent))+'%' in text
            assert contract.balance_terms in text
            assert '100% предоплаты' not in text
        else: assert contract.balance_terms not in text

def test_signature_spacing(supplier):
    assert party_values(supplier.party,'Исполнитель')['signature_block'].startswith('\n\n\n')

def test_delete_versions_and_contract(logged,contract,supplier,monkeypatch):
    from pathlib import Path
    monkeypatch.setattr('app.main.convert_pdf',lambda docx,pdf: Path(pdf).write_bytes(b'%PDF-test'))
    assert logged.put('/api/profile',json=supplier.model_dump()).status_code==200
    c=logged.post('/api/contracts',json=contract.model_dump()).json()
    issues=[logged.post(f"/api/contracts/{c['id']}/generate",json={'revision':0,'request_id':str(uuid.uuid4())}).json() for _ in range(2)]
    assert logged.delete('/api/issues/'+issues[0]['id']).status_code==200
    assert logged.get('/api/issues/'+issues[0]['id']+'/files/docx').status_code==404
    assert logged.get('/api/issues/'+issues[1]['id']+'/files/docx').status_code==200
    assert len(logged.get('/api/contracts/'+c['id']).json()['issues'])==1
    assert logged.delete('/api/contracts/'+c['id']+'?revision=1').status_code==409
    assert logged.delete('/api/contracts/'+c['id']+'?revision=0').status_code==200
    assert logged.get('/api/contracts/'+c['id']).status_code==404
    assert logged.get('/api/issues/'+issues[1]['id']+'/files/pdf').status_code==404

def test_delete_auth(client):
    assert client.delete('/api/contracts/none?revision=0').status_code==401
    assert client.delete('/api/issues/none').status_code==401

def test_missing_balance_terms(contract,supplier):
    contract.prepayment_percent='30';contract.balance_terms=''
    assert 'balance_terms' in validate_generation(contract,supplier)

def test_custom_payment_terms_are_required(contract,supplier):
    contract.payment_option='other';contract.payment_other=''
    assert validate_generation(contract,supplier)['payment_other']=='Укажите условия оплаты'

@pytest.mark.parametrize('kind', ['simple','full'])
@pytest.mark.parametrize('option,other,expected', [
    ('prepayment','','100%'),
    ('other','50% при подписании, остаток после приёмки','50% при подписании, остаток после приёмки'),
])
def test_new_payment_options_in_document(kind,option,other,expected,tmp_path,contract,supplier):
    contract.type=kind;contract.payment_option=option;contract.payment_other=other
    path=tmp_path/'contract.docx';generate_docx(contract,supplier,path)
    with ZipFile(path) as z:
        root=E.fromstring(z.read('word/document.xml'))
        text=''.join(root.itertext())
    assert expected in text
    if kind=='full':
        clause=''.join(root.xpath('.//w:p[.//w:t[contains(text(), "3.2.")]]',namespaces={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'})[0].itertext())
        assert expected in clause

def test_cannot_delete_during_conversion(logged,contract,supplier,monkeypatch):
    from pathlib import Path
    logged.put('/api/profile',json=supplier.model_dump())
    c=logged.post('/api/contracts',json=contract.model_dump()).json()
    def convert(docx,pdf):
        issue_id=Path(docx).parent.name
        assert logged.delete('/api/issues/'+issue_id).status_code==409
        assert logged.delete('/api/contracts/'+c['id']+'?revision=0').status_code==409
        Path(pdf).write_bytes(b'%PDF-test')
    monkeypatch.setattr('app.main.convert_pdf',convert)
    issue=logged.post('/api/contracts/'+c['id']+'/generate',json={'revision':0,'request_id':str(uuid.uuid4())}).json()
    assert issue['status']=='ready'
