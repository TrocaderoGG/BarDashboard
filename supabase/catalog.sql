-- QP planning assumptions recovered from the earlier dashboard. No stock counts are seeded.
insert into public.products(id,definition) values
('tap', '{"supplier":"Spendrups","requestFactor":50,"id":"tap","name":"Tap beer","group":"Beer & cider","unit":"glasses","pack":50,"rate":75,"minimum":25,"capacity":350,"requestUnit":"30 L kegs","note":"50 usable glasses per keg · 7 keg slots"}'::jsonb),
('beer50', '{"supplier":"Spendrups","requestFactor":1,"id":"beer50","name":"Beer · 50 cl","group":"Beer & cider","unit":"bottles","pack":15,"rate":12.8,"minimum":5}'::jsonb),
('beer33', '{"supplier":"Spendrups","requestFactor":1,"id":"beer33","name":"Beer · 33 cl","group":"Beer & cider","unit":"bottles","pack":24,"rate":5.4,"minimum":5}'::jsonb),
('guinness', '{"supplier":"Martin & Servera","requestFactor":1,"id":"guinness","name":"Guinness · 44 cl","group":"Beer & cider","unit":"cans","pack":24,"rate":21.7,"minimum":8}'::jsonb),
('cider', '{"supplier":"Spendrups","requestFactor":1,"id":"cider","name":"Cider · 33 cl","group":"Beer & cider","unit":"bottles","pack":24,"rate":34.2,"minimum":12}'::jsonb),
('smirnoff', '{"supplier":"Spendrups","requestFactor":1,"id":"smirnoff","name":"Smirnoff Ice","group":"Beer & cider","unit":"bottles","pack":24,"rate":7.3,"minimum":5}'::jsonb),
('alcoholfree', '{"supplier":"Spendrups","requestFactor":1,"id":"alcoholfree","name":"Alcohol-free beer / cider","group":"Alcohol-free","unit":"bottles","pack":24,"rate":2,"minimum":4,"packAssumed":true}'::jsonb),
('cola', '{"supplier":"Spendrups","requestFactor":1,"id":"cola","name":"Coca-Cola","group":"Soft drinks","unit":"cans","pack":20,"rate":5,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('colazero', '{"supplier":"Spendrups","requestFactor":1,"id":"colazero","name":"Coca-Cola Zero","group":"Soft drinks","unit":"cans","pack":20,"rate":4,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('fanta', '{"supplier":"Spendrups","requestFactor":1,"id":"fanta","name":"Fanta","group":"Soft drinks","unit":"cans","pack":20,"rate":3,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('fantazero', '{"supplier":"Spendrups","requestFactor":1,"id":"fantazero","name":"Fanta Zero","group":"Soft drinks","unit":"cans","pack":20,"rate":2,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('sprite', '{"supplier":"Spendrups","requestFactor":1,"id":"sprite","name":"Sprite","group":"Soft drinks","unit":"cans","pack":20,"rate":4,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('spritezero', '{"supplier":"Spendrups","requestFactor":1,"id":"spritezero","name":"Sprite Zero","group":"Soft drinks","unit":"cans","pack":20,"rate":3,"minimum":5,"capacity":40,"note":"Variant split is a planning assumption"}'::jsonb),
('redbull', '{"supplier":"Spendrups","requestFactor":1,"id":"redbull","name":"Red Bull","group":"Soft drinks","unit":"cans","pack":24,"rate":4,"minimum":4,"capacity":24,"note":"Includes estimated mixer use"}'::jsonb),
('redbullzero', '{"supplier":"Spendrups","requestFactor":1,"id":"redbullzero","name":"Red Bull Sugarfree","group":"Soft drinks","unit":"cans","pack":24,"rate":3,"minimum":4,"capacity":24,"note":"Includes estimated mixer use"}'::jsonb),
('pet', '{"supplier":"Spendrups","requestFactor":1,"id":"pet","name":"Soft drinks · 50 cl PET","group":"Soft drinks","unit":"bottles","pack":24,"rate":6,"minimum":4,"note":"24 per Spendrups crate; M&S packs vary"}'::jsonb),
('sparkling', '{"supplier":"Spendrups","requestFactor":1,"id":"sparkling","name":"Sparkling wine","group":"Wine","unit":"bottles","pack":1,"rate":0,"minimum":0,"note":"Event orders only; pack size needs confirmation"}'::jsonb)
on conflict(id) do update set definition=excluded.definition;
