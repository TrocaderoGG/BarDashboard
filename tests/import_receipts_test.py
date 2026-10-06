import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_receipts import extract,ownership,ore,spend_lines

class ReceiptTests(unittest.TestCase):
    def test_ownership_is_not_inferred_from_products(self):
        for ref in ['QP20260913','QP-20250907','QP20260830-PHÖZ']:self.assertEqual(ownership(ref),'qp')
        for ref in ['','QP','20251104QP','QP02/06/2026','QP20261399']:self.assertEqual(ownership(ref),'review')
        for ref in ['WEB','ISB140926']:self.assertEqual(ownership(ref),'excluded')
        for ref in ['QP','20251104QP','200325QP','QP02/06/2026']:self.assertEqual(ownership(ref,True),'qp')
    def test_mixed_invoice_boundaries_returns_and_fees(self):
        text='''SAMLINGSFAKTURA
Fakturanummer Fakturadatum Förfallodatum
2026000000001 2026-09-16 2026-09-25
Kund 1234567 - Pub Leveransdatum 2026-09-15
Ordernummer 111 Ert ordernummer QP20260913
Leveransnummer 123
STARKÖL 3,6 - 5,6%
1198491 Beer 30l fat 2 KLI 150,00 50,00 100,00 200,00
Leveransavgift 50,00
Ordertotal SEK 250,00
Kund 1234567 - Pub Leveransdatum 2026-09-22
Ordernummer 111 Ert ordernummer QP20260913
Leveransnummer 124
Återtaget emballage
39512 FAT 30L -1 KLI 500,00 500,00 -500.00
Ordertotal SEK -500,00
Kund 1234567 - Pub Leveransdatum 2026-09-15
Ordernummer 222 Ert ordernummer ISB140926
Leveransnummer 125
STARKÖL 3,6 - 5,6%
1198491 QP named product 1 KLI 150,00 50,00 100,00 100,00
Ordertotal SEK 100,00'''
        source=dict(id='test',title='test.pdf',url='https://drive.google.com/file/d/test/view',text=text)
        rows=extract(source)
        self.assertEqual([r['status'] for r in rows],['qp','qp','excluded'])
        self.assertEqual([r['net_ore'] for r in rows],[25000,-50000,10000])
        self.assertEqual(rows[1]['lines'][0]['kind'],'returns')
        source['text']=text.replace('Ordertotal SEK 250,00','Ordertotal SEK 251,00')
        self.assertEqual(extract(source)[0]['status'],'review')
    def test_localized_amounts_wrapping_and_pack_size(self):
        for value in ['1 234,56','1.234,56','1234.56']: self.assertEqual(ore(value),123456)
        rows=spend_lines('STARKÖL 3,6 - 5,6%\n1104201 Beer 50cl 2 KLI 15 300,00 50,00 250,00 500,00',False)
        self.assertEqual(rows[0]['pack_size'],15)
        rows=spend_lines('VIN 2,26-4,5%\n1731605 Briska Svarta Vinbär\nSleek\n1 KLI 529,15 95,04 434,11 434,11',True)
        self.assertEqual(rows[0]['net_ore'],43411)
        self.assertIsNone(rows[0]['pack_size'])
if __name__=='__main__':unittest.main()
