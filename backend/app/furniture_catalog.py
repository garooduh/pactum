"""Bounded, read-only OOXML catalog import. No spreadsheet formulas are executed."""
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree as E
import hashlib
import posixpath

S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
D = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

def parse_catalog(raw):
    if len(raw)>20*1024*1024: raise ValueError('Файл превышает 20 МБ')
    try:
        with ZipFile(BytesIO(raw)) as z:
            if len(z.infolist())>5000 or sum(i.file_size for i in z.infolist())>100*1024*1024:
                raise ValueError('Слишком большой распакованный XLSX')
            def xml(name):
                content=z.read(name)
                if b'<!DOCTYPE' in content or b'<!ENTITY' in content: raise ValueError('Недопустимый XML')
                return E.fromstring(content)
            def relations(part):
                parent=posixpath.dirname(part)
                relpath=posixpath.join(parent,'_rels',posixpath.basename(part)+'.rels')
                if relpath not in z.namelist(): return {}
                return {r.get('Id'):posixpath.normpath(r.get('Target').lstrip('/') if r.get('Target','').startswith('/') else posixpath.join(parent,r.get('Target',''))) for r in xml(relpath) if r.get('TargetMode')!='External'}
            sheets=xml('xl/workbook.xml').find(S+'sheets')
            sheet=next((s for s in sheets if s.get('name')=='Изделия'),None)
            if sheet is None: raise ValueError('Нет листа «Изделия»')
            part=relations('xl/workbook.xml')[sheet.get(R+'id')]
            strings=[''.join(t.text or '' for t in x.iter(S+'t')) for x in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in z.namelist() else []
            rows=xml(part).find(S+'sheetData')
            def values(row):
                result={}
                for cell in row:
                    col=''.join(c for c in cell.get('r','') if c.isalpha())
                    v=cell.find(S+'v'); value=v.text if v is not None else ''.join(t.text or '' for t in cell.iter(S+'t'))
                    result[col]=strings[int(value)] if cell.get('t')=='s' else (value or '')
                return result
            headers={v.strip():k for k,v in values(rows[0]).items()}
            required=['артикул','наименование','раздел','размеры_ВШГ_мм']
            if any(h not in headers for h in required): raise ValueError('Не найдены обязательные столбцы каталога')
            images={}; assets={}
            for drawing in xml(part).iter(S+'drawing'):
                drawingpart=relations(part)[drawing.get(R+'id')]; rels=relations(drawingpart)
                for anchor in xml(drawingpart):
                    origin=anchor.find(D+'from'); blip=anchor.find('.//'+A+'blip')
                    if origin is None or blip is None: continue
                    row=int(origin.find(D+'row').text)+1
                    target=rels.get(blip.get(R+'embed'))
                    if not target: continue
                    content=z.read(target)
                    if not content.startswith(b'\x89PNG\r\n\x1a\n'): continue
                    digest=hashlib.sha256(content).hexdigest()+'.png'
                    images[row]=digest; assets[digest]=content
            result=[]; seen=set()
            for row in list(rows)[1:]:
                cells=values(row)
                def get(key): return cells.get(headers.get(key,''),'').strip()
                article=get('артикул')
                if not article and not get('наименование'): continue
                if not article or not get('наименование'): raise ValueError(f'Строка {row.get("r")}: пустой артикул или название')
                if article in seen: raise ValueError(f'Строка {row.get("r")}: повтор артикула {article}')
                seen.add(article)
                result.append(dict(article=article,name=get('наименование'),section=get('раздел'),dimensions=get('размеры_ВШГ_мм'),description=get('описание'),reference_price=get('цена_по_каталогу'),image=images.get(int(row.get('r')),'')))
            if not result or len(result)>5000: raise ValueError('Каталог пуст или содержит больше 5000 позиций')
            return result,assets
    except (BadZipFile,KeyError,IndexError,E.ParseError,TypeError) as exc:
        raise ValueError('Некорректная структура XLSX') from exc
