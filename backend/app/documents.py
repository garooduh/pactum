from copy import deepcopy
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED
import json
import os
import re
import subprocess
from threading import Lock
from lxml import etree as E
from .schemas import ContractData, Profile, Party, totals, numeric, payment_percent

TEMPLATES = Path(os.getenv('TEMPLATES_DIR', Path(__file__).resolve().parents[2] / 'templates'))
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w': W}
TOKEN=re.compile(r'\{\{([a-z_]+)\}\}')
MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
def money(value): return f'{value:,.2f}'.replace(',','\u00a0').replace('.',',')
def template_info(kind): return json.loads((TEMPLATES/'manifest.json').read_text())[kind]

def party_values(p: Party, role: str):
    representative = p.kind=='company' or p.representative
    intro=p.full_name
    if representative:
        intro+=f', в лице {p.position_genitive} {p.person_genitive}, действующего на основании {p.basis}'
    else:
        intro+=f', ИНН {p.inn}, ОГРНИП {p.registration}'
    intro+=f', именуемое в дальнейшем «{role}»' if p.kind=='company' else f', именуемый в дальнейшем «{role}»'
    details=[f'ИНН {p.inn}']
    if p.kind=='company': details.append(f'КПП {p.kpp}')
    details += [f'{"ОГРН" if p.kind=="company" else "ОГРНИП"} {p.registration}', f'Банк: {p.bank}', f'БИК {p.bik}',f'Р/с {p.account}',f'К/с {p.correspondent}',f'Адрес: {p.address}']
    if p.email: details.append(f'Почта: {p.email}')
    if p.phone: details.append(f'Тел.: {p.phone}')
    return {**p.model_dump(), 'intro':intro, 'tax': p.inn+(f' / {p.kpp}' if p.kind=='company' else ''), 'details':'\n'.join(details), 'signature_block':'\n\n\n'+p.short_name+'\n'+(p.position if representative else '')+'\n'+f'\n________________ / {p.signature} /\nМ.П.'}

def replace_tokens(root, mapping):
    # Single substitution pass: user input is literal text, never template code or XML.
    for t in list(root.xpath('.//w:t', namespaces=NS)):
        if not t.text or not TOKEN.search(t.text): continue
        original=t.text
        def resolve(match):
            key=match.group(1)
            if key not in mapping: raise ValueError(f'Unknown template slot: {key}')
            return str(mapping[key])
        value=TOKEN.sub(resolve,original)
        lines=value.split('\n'); t.text=lines[0]; t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        previous=t
        for line in lines[1:]:
            br=E.Element(f'{{{W}}}br'); previous.addnext(br)
            new=E.Element(f'{{{W}}}t'); new.text=line; new.set('{http://www.w3.org/XML/1998/namespace}space','preserve'); br.addnext(new); previous=new

def generate_docx(data: ContractData, profile: Profile, destination: Path):
    info=template_info(data.type)
    d=date.fromisoformat(data.date)
    mapping={'number':data.number,'city':data.city,'title':data.title,'date':f'{d.day} {MONTHS[d.month-1]} {d.year} г.'}
    if data.payment_option == 'prepayment':
        payment = ('100% предоплаты.' if data.type == 'full' else
                   'Покупатель вносит предоплату 100% стоимости товара в течение 3 банковских дней со дня выставления счета.')
    elif data.payment_option == 'other':
        payment = data.payment_other
    else:
        # Compatibility with drafts saved before the two-option payment field.
        percent=payment_percent(data.prepayment_percent)
        if data.type=='full':
            if percent==100:
                payment='100% предоплаты.'
            elif percent==0:
                payment=f'оплаты без предоплаты. Заказчик оплачивает 100% стоимости {data.balance_terms}.'
            else:
                payment=f'{percent}% предоплаты. Оставшиеся {100-percent}% стоимости Заказчик оплачивает {data.balance_terms}.'
        else:
            payment=(f'Покупатель вносит предоплату {percent}% стоимости товара в течение 3 банковских дней со дня выставления счета.' if percent else 'Оплата производится без предоплаты.')
            if percent<100: payment+=f' Оставшиеся {100-percent}% стоимости товара Покупатель оплачивает {data.balance_terms}.'
    mapping['payment_terms']=payment
    for prefix,party,role in [('customer',data.customer,'Заказчик' if data.type=='full' else 'Покупатель'),('supplier',profile.party,'Исполнитель' if data.type=='full' else 'Поставщик')]:
        mapping.update({prefix+'_'+k:v for k,v in party_values(party,role).items()})
    if data.type=='full':
        spec=data.specification
        lines,total=totals(spec)
        mapping.update({k:v for k,v in spec.model_dump().items() if k not in ['items', 'number']})
        mapping.update({'spec_number':spec.number,'total':money(total)})
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_suffix('.tmp')
    with ZipFile(TEMPLATES/info['file']) as source, ZipFile(temporary,'w',ZIP_DEFLATED) as output:
        for entry in source.infolist():
            raw=source.read(entry.filename)
            if entry.filename=='word/document.xml':
                root=E.fromstring(raw)
                if data.type=='full':
                    row=root.xpath('.//w:tr[.//w:t[contains(text(), "{{item_name}}")]]',namespaces=NS)[0]
                    anchor=E.Comment('positions'); row.addprevious(anchor); row.getparent().remove(row)
                    replace_tokens(root,mapping)
                    for index,(item,amount) in enumerate(zip(spec.items,lines),1):
                        clone=deepcopy(row)
                        item_map={'item_'+key:value for key,value in item.model_dump().items()}
                        item_map.update({'item_index':str(index),'item_price':money(numeric(item.price)),'item_quantity':str(numeric(item.quantity,quantity=True)).replace('.',','),'item_amount':money(amount)})
                        replace_tokens(clone,item_map); anchor.addprevious(clone)
                    anchor.getparent().remove(anchor)
                else:
                    replace_tokens(root,mapping)
                raw=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
            output.writestr(entry,raw)
    temporary.replace(destination)

_pdf_lock = Lock()

def convert_pdf(docx: Path, target: Path):
    # Keep peak memory bounded on the single-user server.
    with _pdf_lock:
        _convert_pdf(docx, target)

def _convert_pdf(docx: Path, target: Path):
    """Convert the exact persisted DOCX. Each process has an isolated LO profile."""
    with TemporaryDirectory(prefix='pact-pdf-') as temp:
        work=Path(temp)
        command=[os.getenv('LIBREOFFICE_BIN','soffice'),f'-env:UserInstallation={(work/"profile").as_uri()}','--headless','--convert-to','pdf:writer_pdf_Export','--outdir',str(work),str(docx.resolve())]
        subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90,check=True)
        pdf=work/(docx.stem+'.pdf')
        if not pdf.exists() or pdf.stat().st_size<100: raise RuntimeError('PDF conversion failed')
        temp_target=target.with_suffix('.pdf.tmp'); temp_target.write_bytes(pdf.read_bytes()); temp_target.replace(target)
