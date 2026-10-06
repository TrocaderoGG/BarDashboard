import unittest
import sys
import tempfile
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_sales import number,date,convert

class ImportTests(unittest.TestCase):
    def test_swedish_numbers_and_dates(self):
        self.assertEqual(number('−1\u00a0234,50'),Decimal('-1234.50'))
        self.assertEqual(date('3 okt. 2026 01:20'),'2026-10-03')
        self.assertEqual(date('29 mars 2026 18:30'),'2026-03-29')
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

if __name__=='__main__':unittest.main()
