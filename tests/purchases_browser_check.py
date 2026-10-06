"""Local purchase history QA. Run npm dev first; needs optional private import."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
orders=json.loads((ROOT/'private/purchases.json').read_text())
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:4173/#history',wait_until='networkidle')
    panel=page.locator('section').filter(has=page.get_by_role('heading',name='Purchase history',exact=True))
    expect(panel).to_be_visible()
    page.get_by_label('From',exact=True).fill('2025-01-01')
    page.get_by_label('To',exact=True).fill('2026-10-03')
    page.get_by_role('button',name='Apply dates').click()
    assert panel.locator('details').count()==len(orders)
    for summary in panel.locator('summary').all():assert 'ISB140926' not in summary.inner_text()
    panel.locator('summary').first.click()
    expect(panel.get_by_role('link',name='Open invoice').first).to_be_visible()
    assert panel.locator('tbody tr').first.is_visible()
    page.get_by_label('From',exact=True).fill('2026-09-01')
    page.get_by_label('To',exact=True).fill('2026-09-30')
    page.get_by_role('button',name='Apply dates').click()
    assert panel.locator('details').count()==sum('2026-09-01'<=o['date']<='2026-09-30' for o in orders)
    page.set_viewport_size({'width':390,'height':844})
    panel.locator('summary').first.click()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.screenshot(path=str(ROOT/'test-results/purchases-mobile.png'),full_page=True)
    assert not errors,errors
    browser.close()
print('Purchase browser checks passed: sources, item details, date filters, excluded orders and mobile width.')
