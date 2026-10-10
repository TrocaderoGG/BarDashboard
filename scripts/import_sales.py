"""Convert the uploaded SumUp transaction export to private, QP-only daily totals.

The raw CSV is never copied into the website. No account emails, card types or
transaction identifiers survive aggregation. Money is stored in integer öre.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import re
from collections import defaultdict, Counter
from decimal import Decimal
from pathlib import Path

CATEGORIES = {'QP', 'QP-NPR', 'QP-VPR', 'QP-Pitbull', 'QP-Plåt'}
MONTHS = {'jan': 1, 'feb': 2, 'mars': 3, 'mar': 3, 'apr': 4, 'maj': 5, 'juni': 6, 'jun': 6, 'juli': 7, 'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'okt': 10, 'nov': 11, 'dec': 12}

def number(value):
    return Decimal(re.sub(r'[\s\u00a0\u202f]', '', value).replace('−', '-').replace(',', '.'))

def timestamp(value):
    match = re.fullmatch(r'(\d{1,2}) ([a-z]+)\.? (\d{4}) (\d{2}):(\d{2})', value.strip().lower())
    if not match:
        raise ValueError(f'Unrecognized Swedish transaction date: {value!r}')
    day, month, year, hour, minute = match.groups()
    # SumUp's Swedish export uses local Stockholm wall-clock times.
    return dt.datetime(int(year), MONTHS[month], int(day), int(hour), int(minute))

def date(value):
    return timestamp(value).date().isoformat()

def pub_date(value):
    return (timestamp(value)-dt.timedelta(hours=4)).date().isoformat()

def convert(path):
    raw = Path(path).read_bytes()
    with Path(path).open(encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source)
        required = {'Datum', 'Typ', 'Antal', 'Beskrivning', 'Kategori', 'Pris (brutto)', 'Valuta'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('Expected a dated SumUp transaction export, not a product-total report.')
        rows = list(reader)
    product_categories = defaultdict(set)
    for row in rows:
        if row['Kategori'].strip():
            product_categories[row['Beskrivning'].strip()].add(row['Kategori'].strip())
    aggregate = defaultdict(lambda: {'quantity': Decimal(0), 'gross_ore': 0, 'source_rows': 0})
    pub_aggregate = defaultdict(lambda: {'quantity': Decimal(0), 'gross_ore': 0, 'source_rows': 0})
    audit = Counter()
    for row in rows:
        category, product = row['Kategori'].strip(), row['Beskrivning'].strip()
        if not category and row['Typ'] == 'Återbetalning':
            candidates = product_categories[product]
            if len(candidates) == 1 and next(iter(candidates)) in CATEGORIES:
                category = next(iter(candidates))
                audit['matched_blank_refunds'] += 1
        if category not in CATEGORIES:
            audit['unclassified_rows' if not category else 'excluded_other_chapter_rows'] += 1
            continue
        if row['Typ'] not in {'Köp', 'Återbetalning'} or row['Valuta'] != 'SEK':
            raise ValueError('Unsupported QP transaction type or currency. Review before importing.')
        gross = number(row['Pris (brutto)'])
        quantity = number(row['Antal'])
        refund = row['Typ'] == 'Återbetalning' or gross < 0
        if refund:
            gross, quantity = -abs(gross), -abs(quantity)
            audit['refund_rows'] += 1
        key = (date(row['Datum']), category, product)
        entry = aggregate[key]
        entry['quantity'] += quantity
        entry['gross_ore'] += int((gross * 100).quantize(Decimal('1')))
        entry['source_rows'] += 1
        pub_key = (pub_date(row['Datum']), category, product)
        pub_entry = pub_aggregate[pub_key]
        pub_entry['quantity'] += quantity
        pub_entry['gross_ore'] += int((gross * 100).quantize(Decimal('1')))
        pub_entry['source_rows'] += 1
        if pub_key[0] != key[0]: audit['overnight_rows'] += 1
        audit['included_rows'] += 1
    totals = [{'date': d, 'category': c, 'product': p, 'quantity': float(v['quantity']), 'gross_ore': v['gross_ore'], 'source_rows': v['source_rows']} for (d,c,p), v in sorted(aggregate.items())]
    pub_totals = [{'date': d, 'category': c, 'product': p, 'quantity': float(v['quantity']), 'gross_ore': v['gross_ore'], 'source_rows': v['source_rows']} for (d,c,p), v in sorted(pub_aggregate.items())]
    return {'pub_rows': pub_totals, 'pub_cutoff_hour': 4, 'pub_time_zone': 'Europe/Stockholm', 'overnight_rows': audit['overnight_rows'], 'meta': {'id': hashlib.sha256(raw).hexdigest(), 'filename': Path(path).name, 'range_start': '2026-01-01', 'range_end': '2026-10-03', 'first_sale': min(r['date'] for r in totals), 'last_sale': max(r['date'] for r in totals), 'source_rows': len(rows), 'included_rows': audit['included_rows'], 'excluded_rows': audit['excluded_other_chapter_rows'], 'unclassified_rows': audit['unclassified_rows'], 'refund_rows': audit['refund_rows'], 'gross_ore': sum(r['gross_ore'] for r in totals), 'quantity': sum(r['quantity'] for r in totals)}, 'rows': totals}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv')
    parser.add_argument('--output', default='private/sales.json')
    parser.add_argument('--from-date', default='2026-01-01', help='Inclusive export coverage, including days with no sales')
    parser.add_argument('--to-date', default='2026-10-03')
    args = parser.parse_args()
    data = convert(args.csv)
    for value in [args.from_date,args.to_date]: dt.date.fromisoformat(value)
    if args.from_date > data['meta']['first_sale'] or args.to_date < data['meta']['last_sale']: raise ValueError('Coverage must include every transaction date.')
    data['meta']['range_start'],data['meta']['range_end']=args.from_date,args.to_date
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    # Feed this to the authenticated import RPC in the SQL editor or a trusted importer.
    payload = json.dumps(data, ensure_ascii=False).replace("'", "''")
    output.with_suffix('.sql').write_text("-- Private data. Run as the project administrator after schema.sql.\nselect public.import_sales_admin('"+payload+"'::jsonb);\n", encoding='utf-8')
    pub_payload = json.dumps({'import_id': data['meta']['id'], 'cutoff_hour': 4, 'time_zone': 'Europe/Stockholm', 'rows': data['pub_rows']}, ensure_ascii=False).replace("'", "''")
    output.with_name('sales-pubs.sql').write_text("-- Private data. Run after supabase/pub_sessions.sql and the original calendar import.\nselect public.import_pub_sales_admin('"+pub_payload+"'::jsonb);\n", encoding='utf-8')
    print(json.dumps(data['meta'], ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
