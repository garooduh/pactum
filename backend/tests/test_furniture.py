from io import BytesIO
from zipfile import ZipFile
from docx import Document
import pytest
from app.furniture_catalog import parse_catalog


def test_catalog_and_images(logged):
    catalog=logged.get('/api/furniture/catalog').json()
    assert len(catalog['items'])==170
    image=catalog['items'][0]['image']
    assert logged.get('/api/furniture/images/'+image).content.startswith(b'\x89PNG')
    assert logged.post('/api/furniture/catalog',content=b'bad').status_code==422
    assert logged.get('/api/furniture/catalog').json()==catalog


def test_lists_revision_snapshot_and_document(logged,monkeypatch):
    from app import furniture
    monkeypatch.setattr(furniture,'convert_pdf',lambda *args: (_ for _ in ()).throw(RuntimeError()))
    x=logged.post('/api/furniture/lists').json()
    data={'title':'Тест','rooms':['Кабинет А','Кабинет Б'],'items':[
        {'article':'AR-01','name':'Тумба','dimensions':'1 × 2 × 3','room':r,'quantity':q,'price':p}
        for r,q,p in [('Кабинет А','2','12,34'),('Кабинет Б','3','12.34'),('','1','20')]]}
    url='/api/furniture/lists/'+x['id']
    assert logged.put(url,json={'revision':0,'data':data}).status_code==200
    assert logged.put(url,json={'revision':0,'data':data}).status_code==409
    payload={'revision':1,'request_id':'a'*20}
    issue=logged.post(url+'/generate',json=payload).json()
    assert issue['status']=='pdf_failed'
    assert logged.post(url+'/generate',json=payload).json()==issue
    raw=logged.get('/api/furniture/issues/'+issue['id']+'/docx').content
    doc=Document(BytesIO(raw))
    assert len(doc.tables[0].rows)==3
    assert doc.tables[0].rows[1].cells[4].text=='5'
    assert '81.70' in doc.paragraphs[-1].text
    with ZipFile(BytesIO(raw)) as z:
        xml=z.read('word/document.xml').decode()
        assert 'Кабинет' not in xml
        assert not any(n.startswith('word/media') for n in z.namelist())
    data['title']='Изменено'
    assert logged.put(url,json={'revision':1,'data':data}).status_code==200
    assert logged.get('/api/furniture/issues/'+issue['id']+'/docx').content==raw
    assert logged.post(url+'/generate',json={'revision':2,'request_id':'a'*20}).status_code==409
    assert logged.delete(url).status_code==200


def test_auth_and_validation(client,logged):
    x=logged.post('/api/furniture/lists').json()
    data={'title':'Тест','rooms':[],'items':[{'article':'x','name':'x','quantity':'1.5','price':'2'}]}
    assert logged.put('/api/furniture/lists/'+x['id'],json={'revision':0,'data':data}).status_code==422


def test_reject_archive_expansion():
    with pytest.raises(ValueError): parse_catalog(b'not a zip')


def make_xlsx(duplicate=False):
    buffer=BytesIO()
    with ZipFile(buffer,'w') as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Изделия" r:id="s"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s" Target="worksheets/sheet1.xml"/></Relationships>')
        def row(index,values):
            return '<row r="'+str(index)+'">'+''.join(f'<c r="{col}{index}" t="inlineStr"><is><t>{value}</t></is></c>' for col,value in zip('ABCD',values))+'</row>'
        rows=row(1,['артикул','наименование','раздел','размеры_ВШГ_мм'])+row(2,['TEST','Стол','Столы','1 × 2 × 3'])
        if duplicate: rows+=row(3,['TEST','Стол','Столы','1 × 2 × 3'])
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows+'</sheetData></worksheet>')
    return buffer.getvalue()


def test_import_preview_atomic_replace(logged):
    original=logged.get('/api/furniture/catalog').json()
    raw=make_xlsx()
    assert logged.post('/api/furniture/catalog?preview=1',content=raw).json()['count']==1
    assert logged.get('/api/furniture/catalog').json()==original
    imported=logged.post('/api/furniture/catalog',content=raw).json()
    assert imported['items'][0]['article']=='TEST'
    assert logged.post('/api/furniture/catalog',content=make_xlsx(True)).status_code==422
    assert logged.get('/api/furniture/catalog').json()==imported


def test_migration_repeat_and_auth(client):
    from app.furniture_migration import migrate
    engine=client.app.state.Session.kw['bind']
    migrate(engine);migrate(engine)
    assert client.get('/api/furniture/lists').status_code==401
    assert client.get('/api/furniture/catalog').status_code==401
    assert client.post('/api/furniture/catalog',content=make_xlsx()).status_code==401
