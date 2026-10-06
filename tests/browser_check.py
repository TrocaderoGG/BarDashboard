"""Optional browser QA. Run with npm run dev already serving on port 4173."""
from pathlib import Path
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:4173/',wait_until='networkidle')
    expect(page.get_by_role('heading',name='Ready for the next round.')).to_be_visible()
    expect(page.get_by_text('LOCAL PREVIEW',exact=True)).to_be_visible()
    assert page.locator('.stock-table tbody tr').count()==17
    page.get_by_role('button',name='To order',exact=True).click()
    assert 0<page.locator('.stock-table tbody tr').count()<17
    page.get_by_role('button',name='All products',exact=True).click()
    page.screenshot(path=str(OUT/'stock-desktop.png'))

    page.get_by_role('link',name='Trends & history').click()
    expect(page.get_by_role('heading',name='Trends & history')).to_be_visible()
    # Exact totals from the attached CSV, if imported locally.
    if (ROOT/'private/sales.json').exists():
        assert '408' in page.locator('.summary-value').first.inner_text()
        expect(page.get_by_text('October includes 1–3 October only.',exact=False)).to_be_visible()
        page.get_by_label('From',exact=True).fill('2026-09-01')
        page.get_by_label('To',exact=True).fill('2026-09-30')
        page.get_by_role('button',name='Apply dates').click()
        assert page.locator('.history-table tbody tr').count()==1
    page.screenshot(path=str(OUT/'history-desktop.png'))

    page.get_by_role('link',name='Order requests').click()
    page.get_by_label('Event name',exact=True).fill('Browser test event')
    date=(datetime.now()+timedelta(days=1)).date().isoformat()
    page.get_by_label('Event date',exact=True).fill(date)
    page.get_by_label('Expected customers',exact=True).fill('40')
    page.get_by_label('Your name / organizing team',exact=True).fill('QA organizers')
    page.get_by_label('Product 1',exact=True).select_option('tap')
    page.get_by_label('Quantity',exact=True).fill('2')
    expect(page.locator('#request-summary .big')).to_have_text('100')
    page.get_by_role('button',name='Add another product').click()
    page.get_by_label('Product 2',exact=True).select_option('tap')
    page.get_by_role('button',name='Try request in preview',exact=True).click()
    expect(page.get_by_text('Choose each product only once.',exact=True)).to_be_visible()
    page.get_by_label('Product 2',exact=True).select_option('cider')
    page.get_by_label('Anything else?',exact=False).fill('<img src=x onerror="window.bad=true">')
    page.screenshot(path=str(OUT/'requests-desktop.png'))
    page.get_by_role('button',name='Try request in preview',exact=True).click()
    expect(page.get_by_role('heading',name='Preview request recorded')).to_be_visible()
    expect(page.get_by_role('heading',name='Browser test event')).to_be_visible()
    assert page.evaluate('window.bad') is None
    page.get_by_role('button',name='Review request').click()
    page.get_by_label('Link to scheduled opening',exact=False).select_option('preview-pub')
    page.get_by_role('button',name='Save decision').click()
    expect(page.locator('.request-card .tag')).to_have_text('Approved')

    page.get_by_role('link',name='Stock overview').click()
    page.get_by_role('button',name='Update stock',exact=False).click()
    page.get_by_role('button',name='Enter a count').click()
    page.locator('#count-guinness').fill('48')
    page.get_by_role('button',name='Apply preview count').click()
    row=page.get_by_role('row').filter(has_text='Guinness')
    expect(row.locator('.stock-number')).to_have_text('48')
    page.get_by_role('button',name='View keg readiness').click()
    expect(page.get_by_role('heading',name='Keg room')).to_be_visible()
    assert page.locator('.keg-card').count()==7
    page.keyboard.press('Escape')
    expect(page.locator('dialog')).not_to_be_visible()

    # Phone layout and navigation. All content must fit horizontally.
    page.set_viewport_size({'width':390,'height':844})
    for route in ['stock','history','requests']:
        page.goto('http://127.0.0.1:4173/#'+route,wait_until='networkidle')
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),route
        page.screenshot(path=str(OUT/(route+'-mobile.png')),full_page=True)
    page.set_viewport_size({'width':800,'height':900})
    page.evaluate("document.documentElement.style.fontSize='200%'")
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')

    # Production build at an arbitrary GitHub project subpath: no demo or data.
    prod=browser.new_page()
    requests=[]
    prod.on('request',lambda r:requests.append(r.url))
    def route_static(route):
        path=route.request.url.split('/BarDashboard/')[-1].split('?')[0] or 'index.html'
        file=(ROOT/'dist'/path)
        if file.is_file():
            kind={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}.get(file.suffix,'text/plain')
            route.fulfill(status=200,content_type=kind,body=file.read_bytes())
        else:route.fulfill(status=404,body='not found')
    prod.route('https://qp.example/BarDashboard/**',route_static)
    prod.goto('https://qp.example/BarDashboard/',wait_until='networkidle')
    expect(prod.get_by_role('heading',name='Your stock room.')).to_be_visible()
    config_text=(ROOT/'dist/config.js').read_text()
    if 'https://' in config_text:
        expect(prod.get_by_label('Organization email',exact=True)).to_be_visible()
        expect(prod.get_by_role('button',name='Email me a sign-in code')).to_be_visible()
    else:
        expect(prod.get_by_text('Shared workspace setup is pending.',exact=True)).to_be_visible()
    assert not any('__preview' in r or 'sales.json' in r for r in requests)
    assert not errors,errors
    browser.close()
print('Browser checks passed: desktop, 390px mobile, 200% text, requests, validation, review, counts, kegs, and production lock screen.')
