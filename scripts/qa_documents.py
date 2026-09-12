"""Generate deterministic synthetic QA documents; never use real client data."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/tests'))
from conftest import contract, supplier
from app.documents import generate_docx
from app.schemas import Item
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
c=contract.__wrapped__();p=supplier.__wrapped__()
for kind in ['simple','full']:
    c.type=kind;generate_docx(c,p,out/f'{kind}.docx')
c.type='full'
c.customer.full_name='Общество с ограниченной ответственностью «Межрегиональный центр разработки и производства специализированного промышленного оборудования и технологических металлоконструкций»'
c.customer.short_name='ООО «Межрегиональный центр промышленного оборудования»'
c.customer.address='123456, Российская Федерация, г. Москва, муниципальный округ Примерный, улица Производственная, дом 120, корпус 15, строение 3, помещение 103, офис 205'
c.specification.items=[Item(name=f'Изделие {i+1}: металлическая опорная рама для крепления промышленного оборудования',quantity='2,5',price='1234,57',unit='шт.',material='Сталь',dimensions='500 × 800',tolerance='±2 мм') for i in range(18)]
c.specification.description='Изготовление по согласованным чертежам.\n'+('Сварные соединения обработать, острые кромки притупить. ' * 12)
generate_docx(c,p,out/'full-long.docx')
c.type='simple';generate_docx(c,p,out/'simple-long.docx')
