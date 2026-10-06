"""Test password/code UI with mocked Supabase responses. Never sends real email."""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
calls=[]
state={'allow_password':False,'role':'admin'}

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))

    def static(route):
        relative=urlparse(route.request.url).path.removeprefix('/BarDashboard.github.io/') or 'index.html'
        file=ROOT/'dist'/relative
        kind={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}.get(file.suffix,'text/plain')
        route.fulfill(status=200 if file.is_file() else 404,content_type=kind,body=file.read_bytes() if file.is_file() else b'not found')

    def backend(route):
        path=urlparse(route.request.url).path
        if route.request.method=='OPTIONS':
            route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,GET,OPTIONS'})
            return
        calls.append((path,route.request.post_data_json if route.request.post_data else None))
        code,data=200,[]
        if path=='/auth/v1/token':
            assert urlparse(route.request.url).query=='grant_type=password'
            assert route.request.post_data_json=={'email':'tester@example.org','password':'example-test-password'}
            if not state['allow_password']: code,data=400,{'message':'Invalid login credentials'}
            else: data={'access_token':'mock-access','refresh_token':'mock-refresh','expires_in':3600,'user':{'id':'test-user'}}
        elif path=='/auth/v1/logout': code,data=204,None
        elif path=='/auth/v1/otp': code,data=400,{'message':'Email delivery is not configured'}
        elif path=='/rest/v1/rpc/my_role': data=state['role']
        elif path=='/rest/v1/products':
            data=[{'id':'guinness','definition':{'id':'guinness','name':'Guinness','group':'Beer & cider','unit':'cans','rate':21.7,'pack':24,'minimum':8,'supplier':'Martin & Servera'}}]
        route.fulfill(status=code,content_type='application/json',headers={'access-control-allow-origin':'*'},body='' if data is None and code==204 else json.dumps(data))

    page.route('https://qp.example/BarDashboard.github.io/**',static)
    page.route('https://*.supabase.co/**',backend)
    page.goto('https://qp.example/BarDashboard.github.io/',wait_until='networkidle')
    expect(page.get_by_label('Password',exact=True)).to_be_visible()
    page.get_by_label('Email address').fill('tester@example.org')
    page.get_by_label('Password',exact=True).fill('example-test-password')
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.get_by_role('alert')).to_have_text('Invalid login credentials')
    expect(page.get_by_label('Email address')).to_have_value('tester@example.org')
    expect(page.get_by_label('Password',exact=True)).to_have_value('')

    # Valid authentication still does not authorize an unlisted user.
    state.update(allow_password=True,role=None)
    page.get_by_label('Password',exact=True).fill('example-test-password')
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('not on the organization’s member list')
    expect(page.get_by_role('heading',name='On the shelves')).not_to_be_visible()

    state['role']='admin'
    page.get_by_label('Password',exact=True).fill('example-test-password')
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.get_by_role('heading',name='On the shelves')).to_be_visible()
    assert all(path!='/auth/v1/otp' for path,_ in calls)
    assert 'example-test-password' not in page.evaluate('JSON.stringify(sessionStorage)')
    assert page.evaluate('localStorage.length')==0
    page.get_by_role('button',name='Sign out',exact=True).first.click()
    expect(page.get_by_label('Password',exact=True)).to_be_visible()
    assert page.evaluate("sessionStorage.getItem('qp-session')") is None

    page.get_by_role('button',name='Use an email code instead').click()
    expect(page.get_by_label('Password',exact=True)).not_to_be_visible()
    page.get_by_label('Email address').fill('tester@example.org')
    page.get_by_role('button',name='Email me a sign-in code').click()
    expect(page.get_by_role('alert')).to_contain_text('Email delivery is not configured')
    page.get_by_role('button',name='Use a password instead').click()
    expect(page.get_by_label('Password',exact=True)).to_be_visible()
    assert not errors,errors
    browser.close()
print('Mocked auth checks passed: password login, invalid credentials, membership enforcement, logout and optional email-code mode. No real email or credentials were sent.')
