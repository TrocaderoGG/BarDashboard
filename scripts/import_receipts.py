"""Extract reviewable QP purchase history from Drive's readable PDF text.

Input is a private JSON list of {id,title,url,text}. No source text is published.
Fail closed on unknown layouts, ownership, or totals. Never changes stock.
"""
import argparse, datetime as dt, hashlib, json, re
from decimal import Decimal
from pathlib import Path

MONEY = r'-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2}'

def ore(s):
    s=s.replace(' ','')
    if ',' in s: s=s.replace('.','').replace(',','.')
    return int(Decimal(s)*100)

def ownership(ref, legacy=False):
    if re.fullmatch(r'QP-?20\d{6}(?:-[\w-]+)?',ref):
        try: dt.datetime.strptime(re.search(r'20\d{6}',ref)[0],'%Y%m%d')
        except ValueError: return 'review'
        return 'qp'
    if legacy and (ref=='QP' or re.fullmatch(r'\d{6,8}QP',ref) or re.fullmatch(r'QP\d{1,2}/\d{1,2}/20\d{2}',ref)): return 'qp'
    if not ref or 'QP' in ref.upper(): return 'review'
    return 'excluded'

def spend_lines(text, modern):
    # Join only wrapped article descriptions, never headers or distinct rows.
    lines=text.splitlines(); result=[]; section='goods'; pending=''
    for line in lines:
        line=line.strip()
        fee=re.fullmatch(r'Leveransavgift ('+MONEY+')',line)
        if fee:
            result.append(dict(sku='delivery-fee',description='Leveransavgift',quantity=1,unit='ST',pack_size=None,unit_net_ore=ore(fee[1]),net_ore=ore(fee[1]),kind='fee'));continue
        if re.match(r'^(Levererad pall|Återtagen pall|Levererat emballage|Återtaget emballage)$',line):
            section='returns' if line.startswith('Åter') else 'packaging'
        if re.match(r'^(SPRIT|VIN |LÄSK|STARKÖL|LÄTTÖL|ÖVRIGT)',line): section='goods'
        if re.match(r'^[PX]?\d{5,7} [A-Za-zÅÄÖåäö]',line): pending=line
        elif pending and not re.search(r'\s-?\d+(?:,\d+)?\s+(KLI|ST|PAL)\s',pending): pending+=' '+line
        else: continue
        m=re.match(r'^([PX]?\d{5,7}) (.*?) (-?\d+(?:,\d+)?) (KLI|ST|PAL) (.*)$',pending)
        if not m:
            if pending.endswith('0,00'):
                code,name=pending[:-5].strip().split(' ',1)
                result.append(dict(sku=code,description=name,quantity=None,unit=None,pack_size=None,unit_net_ore=None,net_ore=0,kind=section));pending=''
            continue
        code,name,qty,unit,tail=m.groups(); amounts=re.findall(MONEY,tail)
        if len(amounts)<2: continue
        pack=re.match(r'^(\d+) ',tail) if not modern and section=='goods' else None
        result.append(dict(sku=code,description=name,quantity=float(qty.replace(',','.')),unit=unit,pack_size=int(pack[1]) if pack else None,unit_net_ore=ore(amounts[-2]),net_ore=ore(amounts[-1]),kind=section));pending=''
    return result

def ms_lines(text):
    result=[]
    for line in text.splitlines():
        m=re.match(r'^(.*?) (-?\d+(?:,\d+)?) (ST|KRT|BACK|KG|FL|DUNK) (\d{5,8}) (.*)$',line.strip())
        if not m: continue
        name,qty,unit,code,tail=m.groups(); amounts=re.findall(MONEY,tail)
        if len(amounts)<2: continue
        result.append(dict(sku=code,description=name,quantity=float(qty.replace(',','.')),unit=unit,pack_size=1 if unit=='ST' else None,unit_net_ore=ore(amounts[-2]),net_ore=ore(amounts[-1]),kind='packaging' if unit=='BACK' else 'goods'))
    return result

def extract(source, legacy=False):
    text=source['text'].replace('\r','').replace('−','-').replace('\u00a0',' ')
    text=re.sub(r'(?=\d{7} \| \d{13} \|)', '\n', text).replace('Spendrups Bryggeri AB','\nSpendrups Bryggeri AB')
    records=[]
    def add(supplier,invoice,invoice_date,ref,order,delivery,date,body,expected,modern=False):
        lines=ms_lines(body) if supplier=='Martin & Servera' else spend_lines(body,modern)
        status=ownership(ref,legacy); issues=[]
        if status=='review':issues.append('Order reference needs ownership review')
        total=sum(l['net_ore'] for l in lines)
        if expected is None or not lines or total!=expected:
            issues.append(f'Line reconciliation: extracted {total}; printed {expected}')
            if status=='qp':status='review'
        identity='|'.join([supplier,invoice,order,delivery or '',date or '',ref])
        records.append(dict(id=hashlib.sha256(identity.encode()).hexdigest(),supplier=supplier,invoice_number=invoice,invoice_date=invoice_date,order_reference=ref,supplier_order=order,delivery_number=delivery,date=date,source_url=source['url'],source_file=source['title'],source_id=source['id'],net_ore=total,printed_net_ore=expected,lines=lines,status=status,issues=issues))
    if 'Martin & Servera' in text:
        header=re.search(r'Fakturanr Fakt.datum Sida\n(\d+) (\d\d-\d\d-\d\d)',text)
        if not header:raise ValueError('Unknown Martin & Servera header')
        inv,d=header.groups(); start=0
        for m in re.finditer(r'(\d\d-\d\d-\d\d) S:a Följesedel (\d+) : ('+MONEY+r')',text):
            date,delivery,total=m.groups()
            trailer=text[m.end():]
            next_delivery=re.search(r'\d\d-\d\d-\d\d S:a Följesedel',trailer)
            if next_delivery: trailer=trailer[:next_delivery.start()]
            refs=re.findall(r'Order ref: (\d+)([^\n]*)',trailer)
            ref=refs[0][1].strip() if refs else ''
            order=','.join(r[0] for r in refs)
            add('Martin & Servera',inv,'20'+d,ref,order,delivery,'20'+date,text[start:m.start()],ore(total))
            if any(r[1].strip()!=ref for r in refs):
                records[-1]['status']='review';records[-1]['issues'].append('Multiple ownership references on delivery')
            # Fee is printed twice but charged once. Assign only on a single-delivery invoice.
            fees=re.findall(r'(?m)^Miljörabatt/Lev.avgift ('+MONEY+')',trailer)
            if fees and len(re.findall(r'S:a Följesedel',text))==1 and len(set(fees))==1:
                value=ore(fees[0]);record=records[-1]
                record['lines'].append(dict(sku='delivery-fee',description='Miljörabatt/Lev.avgift',quantity=1,unit='ST',pack_size=None,unit_net_ore=value,net_ore=value,kind='fee'))
                record['net_ore']+=value;record['printed_net_ore']+=value
            elif fees:
                records[-1]['status']='review';records[-1]['issues'].append('Delivery fee allocation needs review')
            start=m.end()
        if not records:raise ValueError('No recognizable delivery/order reference')
    elif re.search(r'Fakturanummer Fakturadatum Förfallodatum\n\d+ 20',text):
        inv,d=re.search(r'Fakturanummer Fakturadatum Förfallodatum\n(\d+) (\d{4}-\d\d-\d\d)',text).groups()
        starts=list(re.finditer(r'Kund \d+ - [^\n]* Leveransdatum (\d{4}-\d\d-\d\d)\nOrdernummer (\d+) Ert ordernummer([^\n]*)\nLeveransnummer (\d+)',text))
        if not starts:
            m=re.search(r'Ordernummer Mottagningsnummer\n(\d+)\nLeveransdatum Ert ordernummer\n(20\d\d-\d\d-\d\d) ([^\n]+)',text)
            if not m:raise ValueError('Unknown modern single-order header')
            order,date,ref=m.groups(); total=re.search(r'Ordertotal SEK ('+MONEY+')',text)
            add('Spendrups',inv,d,ref,order,None,date,text,ore(total[1]) if total else None,True)
        for i,m in enumerate(starts):
            date,order,ref,delivery=m.groups();body=text[m.end():starts[i+1].start() if i+1<len(starts) else len(text)]
            totals=re.findall(r'Ordertotal SEK ('+MONEY+')',body)
            add('Spendrups',inv,d,ref.strip(),order,delivery,date,body,ore(totals[-1]) if totals else None,True)
    else:
        inv=re.search(r'(?m)^(\d{9})$',text)[1]; dates=re.findall(r'(?m)^(20\d\d-\d\d-\d\d)$',text);d=dates[0]
        starts=list(re.finditer(r'Er referens\nVår referens\nKundnummer\nKundordernummer Leveransdatum\nErt ordernummer Orderdatum\nKundnamn\n(20\d\d-\d\d-\d\d)\n(?:(.*?) )?(20\d\d-\d\d-\d\d)\n[^\n]*\n\d+\n(\d+)',text))
        if starts:
            for i,m in enumerate(starts):
                date,ref,orderdate,order=m.groups();ref=ref or '';body=text[m.end():starts[i+1].start() if i+1<len(starts) else len(text)]
                total=re.search(r'Ordertotal ('+MONEY+')',body)
                add('Spendrups',inv,d,ref,order,None,date,body,ore(total[1]) if total else None)
        else:
            header=re.search(r'(20\d\d-\d\d-\d\d)\n(20\d\d-\d\d-\d\d)\n(20\d\d-\d\d-\d\d)\n(?:([^\n]*)\n)?fakturaservice',text)
            if not header:raise ValueError('Unknown older Spendrups order header')
            date=header[3];ref=header[4] or '';order=re.search(r'Ordernummer (\d+)',text)[1]
            total=re.search(r'('+MONEY+r') '+MONEY+r' '+MONEY+r' SEK\nAnge OCR',text)
            add('Spendrups',inv,d,ref,order,None,date,text,ore(total[1]) if total else None)
    if not records:raise ValueError('No recognized orders')
    return records

def main():
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--legacy-qp',action='store_true');args=parser.parse_args()
    orders=[];failures=[]
    sources=json.loads(Path(args.source).read_text())
    for source in sources:
        try: orders.extend(extract(source,args.legacy_qp))
        except (ValueError,TypeError,IndexError,AttributeError) as e: failures.append(dict(file=source['title'],url=source['url'],reason=str(e)))
    included=[o for o in orders if o['status']=='qp']
    report=dict(files=len(sources),orders=orders,unparsed=failures)
    out=Path('private');out.mkdir(exist_ok=True)
    (out/'purchases-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (out/'purchases.json').write_text(json.dumps(included,ensure_ascii=False,indent=2))
    migration=Path(__file__).resolve().parents[1]/'supabase/purchases.sql'
    payload=json.dumps(included,ensure_ascii=False).replace("'","''")
    (out/'purchases-import.sql').write_text('-- PRIVATE PURCHASE DATA. Do not commit or publish.\n'+migration.read_text()+"\nselect public.import_purchases_admin('"+payload+"'::jsonb) as orders_added;\n")
    import csv
    with (out/'purchases-review.csv').open('w',newline='') as f:
        writer=csv.writer(f);writer.writerow(['File','Invoice','Order reference','Supplier order','Date','Status','Net SEK excl VAT','Review reason','Source'])
        for o in orders:writer.writerow([o['source_file'],o['invoice_number'],o['order_reference'],o['supplier_order'],o['date'],o['status'],str(Decimal(o['net_ore'])/100),'; '.join(o['issues']),o['source_url']])
    print(json.dumps(dict(files=len(sources),included=len(included),excluded=sum(o['status']=='excluded' for o in orders),review=sum(o['status']=='review' for o in orders),unparsed=failures,net_ore=sum(o['net_ore'] for o in included)),ensure_ascii=False,indent=2))
    for o in orders:
        print(o['source_file'],o['order_reference'],o['status'],len(o['lines']),o['issues'])
if __name__=='__main__':main()
