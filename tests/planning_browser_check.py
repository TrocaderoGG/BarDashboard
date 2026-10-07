"""Fictional event data verifies reservations and mobile delivery planning."""
import json,urllib.request
from playwright.sync_api import sync_playwright,expect
state=json.load(urllib.request.urlopen('http://127.0.0.1:4173/__preview/state'))
state['events']=[dict(id='pub',name='Normal pub',starts_at='2026-10-21T17:00:00Z',kind='pub',multiplier=1,cancelled=False),dict(id='party',name='Event party',starts_at='2026-10-23T17:00:00Z',kind='event',multiplier=1,cancelled=False)]
state['requests']=[dict(id='pending-test',event_name='Event party',event_date='2026-10-23',guests=40,requester_name='Test organizer',notes='',status='pending',created_at='2026-10-07T10:00:00Z',lines=[dict(product_id='cola',quantity=60)])]
for p in state['products']:
 if p['id']=='cola':p.update(rate=20,minimum=0,capacity=40)
for c in state['counts']:
 if c['product_id']=='cola':c['quantity']=30
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':360,'height':800});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/__preview/state',lambda route:route.fulfill(content_type='application/json',body=json.dumps(state)))
 page.goto('http://127.0.0.1:4173/#requests',wait_until='networkidle')
 page.get_by_role('button',name='Review request').click()
 page.get_by_label('Link to scheduled opening (required to approve)').select_option('party')
 expect(page.locator('#request-impact')).to_contain_text('60 reserved for events')
 expect(page.locator('#request-impact')).to_contain_text('3 packs on 20 Oct')
 page.get_by_role('button',name='Save decision').click()
 page.get_by_role('link',name='Stock overview').click()
 page.get_by_text('Pub reservations & delivery planning',exact=True).click()
 section=page.locator('section').filter(has=page.get_by_role('heading',name='Pub & event stock plan'))
 expect(section).to_contain_text('50 cans above comfortable capacity')
 section.get_by_text('What to protect for pubs and events',exact=True).click()
 row=section.locator('.reservation-table tr').filter(has_text='Coca-Cola').first
 expect(row).to_contain_text('60')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 assert not errors,errors
 b.close()
print('Event approval preview, dated delivery, temporary storage warning and mobile reservation layout passed.')
