"""One-time, deterministic slot preparation. Original reference files are never changed."""
from pathlib import Path
from copy import deepcopy
from hashlib import sha256
import json
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
def q(tag): return f'{{{W}}}{tag}'
def text(el): return ''.join(el.itertext()) if False else ''.join(el.xpath('.//w:t/text()', namespaces=NS))
def setp(p, value):
    properties = p.find(q('pPr'))
    runs = p.findall(q('r'))
    rpr = deepcopy(runs[0].find(q('rPr'))) if runs and runs[0].find(q('rPr')) is not None else None
    for child in list(p):
        if child is not properties: p.remove(child)
    r = E.SubElement(p, q('r'))
    if rpr is not None: r.append(rpr)
    t = E.SubElement(r, q('t')); t.set('{http://www.w3.org/XML/1998/namespace}space','preserve'); t.text = value

def setcell(cell, value):
    p = cell.find(q('p'))
    for child in list(cell):
        if child is not p and child.tag != q('tcPr'): cell.remove(child)
    setp(p, value)
    prop = p.find(q('pPr'))
    if prop is not None:
        for child in list(prop):
            if child.tag in [q('ind'), q('tabs'), q('numPr')]: prop.remove(child)
        align = prop.find(q('jc'))
        if align is not None: align.set(q('val'),'left')

def normal(el):
    for b in el.xpath('.//w:rPr/w:b | .//w:rPr/w:bCs', namespaces=NS): b.set(q('val'),'0')

def replace_package(source, target, root):
    with ZipFile(source) as old, ZipFile(target,'w',ZIP_DEFLATED) as new:
        for entry in old.infolist():
            raw = old.read(entry.filename)
            if entry.filename == 'word/document.xml': raw = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif entry.filename == 'docProps/core.xml':
                core = E.fromstring(raw)
                for child in core: child.text = ''
                raw = E.tostring(core, xml_declaration=True, encoding='UTF-8')
            elif entry.filename == 'word/_rels/document.xml.rels':
                rels = E.fromstring(raw)
                used = set(root.xpath('//@r:id | //@r:embed | //@r:link', namespaces={'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}))
                for rel in list(rels):
                    if rel.get('Type','').endswith('/hyperlink') and rel.get('Id') not in used: rels.remove(rel)
                raw = E.tostring(rels, xml_declaration=True, encoding='UTF-8')
            new.writestr(entry, raw)

manifest = {}
for kind in ['full', 'simple']:
    source = ROOT/'templates/source'/f'{kind}.docx'
    with ZipFile(source) as z: root = E.fromstring(z.read('word/document.xml'))
    body=root.find(q('body')); ps=body.findall(q('p')); tables=body.findall(q('tbl'))
    setp(ps[0], 'ДОГОВОР № {{number}}' if kind=='full' else 'ДОГОВОР ПОСТАВКИ № {{number}}')
    setp(ps[3 if kind=='full' else 2], 'г. {{city}}\t{{date}}')
    # Right-aligned tab is stable for varying date lengths; remove source's manual space padding.
    datep=ps[3 if kind=='full' else 2]
    pp=datep.find(q('pPr'))
    if pp is None: pp=E.SubElement(datep,q('pPr'))
    for child in list(pp):
        if child.tag in [q('tabs'),q('ind')]: pp.remove(child)
    tabs=E.SubElement(pp,q('tabs')); tab=E.SubElement(tabs,q('tab')); tab.set(q('val'),'right'); tab.set(q('pos'),'9900')
    if kind=='full':
        setp(ps[1], '{{title}}')
        setp(ps[5], '{{customer_intro}}, с одной стороны,\nи {{supplier_intro}}, с другой стороны, совместно именуемые Стороны, заключили настоящий договор на нижеследующих условиях.')
        requisites=tables[3]
        for idx,prefix in [(0,'customer'),(1,'supplier')]:
            cells=[row.findall(q('tc'))[idx] for row in requisites.findall(q('tr'))]
            setcell(cells[0], ('ЗАКАЗЧИК:' if idx==0 else 'ИСПОЛНИТЕЛЬ:')+'\n\n{{'+prefix+'_short_name}}')
            setcell(cells[1], '{{'+prefix+'_details}}'); normal(cells[1])
            setcell(cells[2], '{{'+prefix+'_signature_block}}'); normal(cells[2])
        setp(ps[103], 'Спецификация № {{spec_number}}\n\nк договору № {{number}} от {{date}}')
        rows=tables[4].findall(q('tr'))
        fields=['index','name','unit','material','dimensions','tolerance','quantity','price','amount']
        for cell,key in zip(rows[1].findall(q('tc')), fields): setcell(cell,'{{item_'+key+'}}')
        # The original number cell spans the total row: unmerge it for repeatable positions.
        for vm in tables[4].xpath('.//w:vMerge',namespaces=NS): vm.getparent().remove(vm)
        for cell in rows[2].findall(q('tc')):
            value=text(cell)
            setcell(cell, '{{total}} руб.' if '190' in value else ('Итого' if 'Сумма' in value else ''))
        hdr=rows[0].find(q('trPr'))
        if hdr is None: hdr=E.SubElement(rows[0],q('trPr'))
        E.SubElement(hdr,q('tblHeader'))
        # Keep each item together across page breaks; make room for 3-digit position numbers.
        grid=tables[4].find(q('tblGrid')).findall(q('gridCol'))
        delta=550-int(grid[0].get(q('w'))); grid[0].set(q('w'),'550'); grid[1].set(q('w'),str(int(grid[1].get(q('w')))-delta))
        for row in rows:
            rp=row.find(q('trPr'))
            if rp is None: rp=E.SubElement(row,q('trPr'))
            E.SubElement(rp,q('cantSplit'))
            cells=row.findall(q('tc'))
            width=cells[0].find(q('tcPr')).find(q('tcW')); width.set(q('w'),'550')
            if row is not rows[2]:
                width=cells[1].find(q('tcPr')).find(q('tcW')); width.set(q('w'),str(int(width.get(q('w')))-delta))
            else:
                width=cells[1].find(q('tcPr')).find(q('tcW')); width.set(q('w'),str(int(width.get(q('w')))-delta))
            mar=E.SubElement(cells[0].find(q('tcPr')),q('tcMar'))
            for side in ['start','end']:
                m=E.SubElement(mar,q(side));m.set(q('w'),'25');m.set(q('type'),'dxa')
            for h in row.xpath('./w:trPr/w:trHeight', namespaces=NS): h.getparent().remove(h)
        setp(ps[106], 'Краткое описание изделия.')
        setp(ps[107], '{{description}}')
        setp(ps[108], ''); setp(ps[109], '')
        setp(ps[111], 'Примечания.')
        setp(ps[112], '{{notes}}'); setp(ps[113], '')
        setp(ps[114], 'Покрытие: {{coating}}\nЦвет: {{color}}')
        setp(ps[116], 'Сроки изготовления: {{deadline}}')
        setp(ps[117], 'Доставка: {{delivery}}')
        setp(ps[118], 'Монтаж: {{installation}}')
        normal(ps[117])
        for p in ps[104:]:
            for drawing in p.xpath('.//w:drawing | .//w:pict', namespaces=NS): drawing.getparent().remove(drawing)
            for ind in p.xpath('./w:pPr/w:ind', namespaces=NS): ind.getparent().remove(ind)
        for i,prefix in enumerate(['customer','supplier']): setcell(tables[5].find(q('tr')).findall(q('tc'))[i], '{{'+prefix+'_signature_block}}')
        signature=deepcopy(tables[5])
        # Remove blank padding after the final signature table.
        for p in ps[120:]:
            if not text(p): body.remove(p)
        endp=E.Element(q('p'));pp=E.SubElement(endp,q('pPr'));spacing=E.SubElement(pp,q('spacing'));spacing.set(q('after'),'0');spacing.set(q('before'),'0');spacing.set(q('line'),'20');spacing.set(q('lineRule'),'exact');body.insert(len(body)-1,endp)
    else:
        setp(ps[4], '{{supplier_intro}}, с одной стороны,\nи {{customer_intro}}, с другой стороны, заключили настоящий Договор о нижеследующем:')
        normal(ps[4])
        keys=['short_name','address','tax','account','correspondent','bank','bik']
        rows=tables[0].findall(q('tr'))
        for row,key in zip(rows[1:],keys):
            cells=row.findall(q('tc'))
            setcell(cells[0], '{{supplier_'+key+'}}'); setcell(cells[2], '{{customer_'+key+'}}')
        for key,label in [('registration','ОГРН / ОГРНИП'),('phone','Телефон'),('email','Почта')]:
            row=deepcopy(rows[-1]); cells=row.findall(q('tc'))
            for cell,value in zip(cells,['{{supplier_'+key+'}}',label,'{{customer_'+key+'}}']): setcell(cell,value)
            tables[0].append(row)
        # Replace space-aligned signature text by a two-column source-derived table.
        sig=deepcopy(signature)
        for i,prefix in enumerate(['supplier','customer']): setcell(sig.find(q('tr')).findall(q('tc'))[i], '{{'+prefix+'_signature_block}}')
        for sz in sig.xpath('.//w:sz | .//w:szCs',namespaces=NS): sz.set(q('val'),'20')
        ps[29].addprevious(sig); body.remove(ps[29]); body.remove(ps[30])
        # Requisites and signatures form one block; long addresses move it to the next page.
        for p in [ps[28],*tables[0].xpath('.//w:p',namespaces=NS)]:
            pp=p.find(q('pPr'))
            if pp is None: pp=E.SubElement(p,q('pPr'))
            E.SubElement(pp,q('keepNext'))
    for paragraph in body.findall(q('p')):
        value=text(paragraph)
        if kind=='full' and '100% предоплаты.' in value:
            # Keep all source formatting/runs except the exact payment phrase.
            for t in paragraph.xpath('.//w:t',namespaces=NS):
                if t.text and '100% предоплаты.' in t.text:
                    t.text=t.text.replace('100% предоплаты.', '{{payment_terms}}')
                    break
            else: setp(paragraph,value.replace('100% предоплаты.', '{{payment_terms}}'))
        elif kind=='simple' and 'Срок полной оплаты' in value:
            setp(paragraph,'{{payment_terms}}')
    for paragraph in root.xpath('.//w:p[.//w:t[contains(text(), "_signature_block}}")]]',namespaces=NS):
        pp=paragraph.find(q('pPr'))
        if pp is None: pp=E.SubElement(paragraph,q('pPr'))
        E.SubElement(pp,q('keepLines'))
        row=paragraph.getparent().getparent()
        if row.tag==q('tr'):
            rp=row.find(q('trPr'))
            if rp is None: rp=E.SubElement(row,q('trPr'))
            E.SubElement(rp,q('cantSplit'))
    target=ROOT/'templates'/f'{kind}-v2.docx'
    replace_package(source,target,root)
    manifest[kind]={'version':f'{kind}-v2-'+sha256(target.read_bytes()).hexdigest()[:12],'file':target.name,'source_sha256':sha256(source.read_bytes()).hexdigest()}
(ROOT/'templates/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
