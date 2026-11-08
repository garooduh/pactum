"""Independent furniture lists and flat document export."""
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from uuid import uuid4
from fastapi import Depends, HTTPException, Response, Request
from fastapi.responses import FileResponse
from threading import Lock
import json
import re
from pydantic import Field, model_validator
from sqlalchemy import select
from docx import Document
from .database import FurnitureList, FurnitureCatalog, FurnitureIssue
from .schemas import Model, numeric
from .documents import convert_pdf

class Row(Model):
    article: str = Field(max_length=100)
    name: str = Field(max_length=1000)
    dimensions: str = Field(default='', max_length=100)
    room: str = Field(default='', max_length=200)
    quantity: str = '1'
    price: str = ''
    image: str = ''
    catalog_id: str = ''

    @model_validator(mode='after')
    def validate_numbers(self):
        q=numeric(self.quantity,quantity=True)
        if q!=q.to_integral_value(): raise ValueError('Количество должно быть целым')
        if self.price: numeric(self.price)
        return self

class ListData(Model):
    title: str = Field(default='Список мебели', max_length=200)
    rooms: list[str] = Field(default_factory=list, max_length=100)
    items: list[Row] = Field(default_factory=list, max_length=1000)

    @model_validator(mode='after')
    def validate_rooms(self):
        if any(not r.strip() or len(r)>200 for r in self.rooms) or len(set(self.rooms))!=len(self.rooms):
            raise ValueError('Названия кабинетов должны быть непустыми и уникальными')
        if any(x.room and x.room not in self.rooms for x in self.items):
            raise ValueError('Кабинет позиции не найден')
        return self

class Generate(Model):
    revision: int
    request_id: str = Field(pattern=r'^[a-zA-Z0-9-]{16,64}$')

class Save(Model):
    revision: int
    data: ListData

def register(app, Session, storage, authenticated):
    @app.get('/api/furniture/lists', dependencies=[Depends(authenticated)])
    def lists():
        with Session() as db:
            return [dict(id=x.id, revision=x.revision, data=x.data) for x in db.scalars(select(FurnitureList))]

    @app.post('/api/furniture/lists', dependencies=[Depends(authenticated)])
    def create():
        with Session.begin() as db:
            x=FurnitureList(id=str(uuid4()), data=ListData().model_dump(), revision=0); db.add(x)
            return dict(id=x.id, revision=0, data=x.data)

    @app.put('/api/furniture/lists/{id}', dependencies=[Depends(authenticated)])
    def save(id: str, payload: Save):
        from sqlalchemy import update
        with Session.begin() as db:
            result=db.execute(update(FurnitureList).where(FurnitureList.id==id, FurnitureList.revision==payload.revision).values(data=payload.data.model_dump(), revision=payload.revision+1))
            if result.rowcount!=1: raise HTTPException(409, 'Список изменён. Откройте его заново.')
        return dict(id=id, revision=payload.revision+1, data=payload.data.model_dump())

    @app.delete('/api/furniture/lists/{id}', dependencies=[Depends(authenticated)])
    def remove(id: str):
        with Session.begin() as db:
            x=db.get(FurnitureList,id)
            if not x: raise HTTPException(404)
            db.delete(x)
        return {'ok':True}

    def install_catalog(raw, preview=False):
        from .furniture_catalog import parse_catalog
        try: data,assets=parse_catalog(raw)
        except ValueError as exc: raise HTTPException(422,str(exc))
        if preview: return {'count':len(data),'images':len(assets)}
        folder=storage/'furniture-images'; folder.mkdir(exist_ok=True)
        for name,content in assets.items():
            path=folder/name
            if not path.exists(): path.write_bytes(content)
        with Session.begin() as db:
            x=FurnitureCatalog(id=str(uuid4()),data=data); db.add(x)
            return dict(id=x.id,items=data)

    @app.get('/api/furniture/catalog', dependencies=[Depends(authenticated)])
    def catalog():
        with Session() as db:
            x=db.scalar(select(FurnitureCatalog).order_by(FurnitureCatalog.created_at.desc()))
            if x: return dict(id=x.id,items=x.data)
        return {'id':'seed-v1','items':json.loads((Path(__file__).parent/'furniture_catalog.json').read_text())}

    @app.post('/api/furniture/catalog', dependencies=[Depends(authenticated)])
    async def upload(request: Request):
        return install_catalog(await request.body(),request.query_params.get('preview')=='1')

    @app.get('/api/furniture/images/{name}', dependencies=[Depends(authenticated)])
    def image(name: str):
        if not re.fullmatch(r'[a-f0-9]{64}\.png',name): raise HTTPException(404)
        path=storage/'furniture-images'/name
        if not path.is_file(): path=Path(__file__).parent/'furniture_seed'/name
        if not path.is_file(): raise HTTPException(404)
        return FileResponse(path,media_type='image/png')

    generation_lock=Lock()
    @app.post('/api/furniture/lists/{id}/generate', dependencies=[Depends(authenticated)])
    def generate(id: str, payload: Generate):
        with generation_lock:
            with Session.begin() as db:
                issue=db.scalar(select(FurnitureIssue).where(FurnitureIssue.request_id==payload.request_id))
                if issue:
                    if issue.list_id!=id or issue.revision!=payload.revision: raise HTTPException(409,'Ключ выпуска уже использован')
                else:
                    x=db.get(FurnitureList,id)
                    if not x: raise HTTPException(404)
                    if x.revision!=payload.revision: raise HTTPException(409,'Список изменён')
                    issue=FurnitureIssue(id=str(uuid4()),list_id=id,request_id=payload.request_id,revision=x.revision,snapshot=x.data,status='generating'); db.add(issue)
                issue_id=issue.id; snapshot=issue.snapshot
            folder=storage/('furniture-'+issue_id); folder.mkdir(exist_ok=True)
            docx=folder/'furniture.docx'; pdf=folder/'furniture.pdf'
            if not docx.exists():
                raw=document_bytes(ListData.model_validate(snapshot)); docx.write_bytes(raw)
            status='ready'
            if not pdf.exists():
                try: convert_pdf(docx,pdf)
                except Exception: status='pdf_failed'
            with Session.begin() as db: db.get(FurnitureIssue,issue_id).status=status
            return dict(id=issue_id,status=status)

    @app.get('/api/furniture/issues/{id}/{format}', dependencies=[Depends(authenticated)])
    def download(id: str, format: str):
        if format not in ('docx','pdf'): raise HTTPException(404)
        with Session() as db:
            if not db.get(FurnitureIssue,id): raise HTTPException(404)
        path=storage/('furniture-'+id)/('furniture.'+format)
        if not path.exists(): raise HTTPException(404,'Документ пока недоступен')
        return FileResponse(path,filename='furniture.'+format)

    def document_bytes(data):
        if not data.items: raise HTTPException(422,'Добавьте мебель')
        merged={}
        for row in data.items:
            try:
                q=numeric(row.quantity,quantity=True); price=numeric(row.price)
                if q<=0 or q!=q.to_integral_value() or price<0: raise ValueError()
            except (ValueError, ArithmeticError): raise HTTPException(422,'Укажите целое количество и цену каждой позиции')
            key=(row.article,row.name,row.dimensions,price)
            merged[key]=merged.get(key,Decimal(0))+q
        from docx.shared import Mm, Pt
        from docx.enum.section import WD_ORIENT
        doc=Document()
        page=doc.sections[0]; page.orientation=WD_ORIENT.LANDSCAPE
        page.page_width=Mm(297); page.page_height=Mm(210)
        page.top_margin=page.bottom_margin=Mm(15)
        page.left_margin=page.right_margin=Mm(15)
        doc.styles['Normal'].font.name='Arial'; doc.styles['Normal'].font.size=Pt(9)
        doc.styles['Normal'].paragraph_format.space_after=Pt(3)
        doc.add_heading(data.title,0)
        from docx.oxml import OxmlElement
        table=doc.add_table(rows=1, cols=7); table.style='Table Grid'
        for c,t in zip(table.rows[0].cells,['№','Артикул','Наименование','В×Ш×Г, мм','Кол-во','Цена, руб.','Сумма, руб.']): c.text=t
        repeat=OxmlElement('w:tblHeader'); table.rows[0]._tr.get_or_add_trPr().append(repeat)
        total=Decimal(0)
        for i,((article,name,dimensions,price),q) in enumerate(merged.items(),1):
            amount=(q*price).quantize(Decimal('.01'),rounding=ROUND_HALF_UP); total+=amount
            for c,t in zip(table.add_row().cells,[i,article,name,dimensions,q,f'{price:.2f}',f'{amount:.2f}']): c.text=str(t)
        table.autofit=False
        for column,width in zip(table.columns,[10,23,106,38,20,30,40]): column.width=Mm(width)
        for row in table.rows:
            row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
            for cell,width in zip(row.cells,[10,23,106,38,20,30,40]): cell.width=Mm(width)
        doc.add_paragraph(f'Итого: {total:.2f} руб.')
        from io import BytesIO
        stream=BytesIO(); doc.save(stream)
        return stream.getvalue()
