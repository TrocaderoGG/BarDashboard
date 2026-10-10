import unittest
import sys
import tempfile
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_sales import number,date,convert,pub_date

class ImportTests(unittest.TestCase):
    def test_swedish_numbers_and_dates(self):
        self.assertEqual(number('−1\u00a0234,50'),Decimal('-1234.50'))
        self.assertEqual(date('3 okt. 2026 01:20'),'2026-10-03')
        self.assertEqual(date('29 mars 2026 18:30'),'2026-03-29')
    def test_pub_dates_use_local_four_am_boundary_including_dst(self):
        self.assertEqual(pub_date('3 okt. 2026 01:20'),'2026-10-02')
        self.assertEqual(pub_date('1 okt. 2026 03:59'),'2026-09-30')
        self.assertEqual(pub_date('1 okt. 2026 04:00'),'2026-10-01')
        self.assertEqual(pub_date('29 mars 2026 03:30'),'2026-03-28')
        self.assertEqual(pub_date('25 okt. 2026 02:30'),'2026-10-24')
    def test_refunds_chapter_filter_and_no_revenue_multiplication(self):
        text='Datum,Typ,Antal,Beskrivning,Kategori,Pris (brutto),Valuta\n1 jan. 2026 18:00,Köp,3,QP Beer,QP,"105,00",SEK\n2 jan. 2026 18:00,Återbetalning,1,QP Beer,,"−35,00",SEK\n2 jan. 2026 18:00,Köp,4,QP named but BBQ,BBQ,"100,00",SEK\n2 jan. 2026 18:00,Köp,1,Unknown,,"25,00",SEK\n'
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'sales.csv';path.write_text(text);data=convert(path)
            self.assertEqual(data['meta']['gross_ore'],7000)
            self.assertEqual(data['meta']['quantity'],2)
            self.assertEqual(data['meta']['included_rows'],2)
            self.assertEqual(data['meta']['unclassified_rows'],1)
            self.assertEqual(data['meta']['excluded_rows'],1)
            self.assertEqual(data['meta']['refund_rows'],1)
            self.assertEqual(sum(r['gross_ore'] for r in data['pub_rows']),data['meta']['gross_ore'])
    def test_friday_midnight_sales_join_the_same_pub_not_saturday_evening(self):
        text='Datum,Typ,Antal,Beskrivning,Kategori,Pris (brutto),Valuta\n2 okt. 2026 23:30,Köp,1,QP Beer,QP,"35,00",SEK\n3 okt. 2026 01:00,Köp,2,QP Beer,QP,"70,00",SEK\n3 okt. 2026 19:00,Köp,1,QP Beer,QP,"35,00",SEK\n'
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'sales.csv';path.write_text(text);data=convert(path)
            self.assertEqual([(r['date'],r['quantity']) for r in data['rows']],[('2026-10-02',1),('2026-10-03',3)])
            self.assertEqual([(r['date'],r['quantity']) for r in data['pub_rows']],[('2026-10-02',3),('2026-10-03',1)])

if __name__=='__main__':unittest.main()
