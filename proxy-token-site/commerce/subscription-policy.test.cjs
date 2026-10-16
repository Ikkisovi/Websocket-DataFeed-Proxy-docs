'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('./subscription-policy.cjs');
const {catalog}=require('./product-catalog.cjs');
const now=Date.parse('2026-10-16T12:00:00Z');
const future='2026-11-16T12:00:00.000Z',past='2026-10-15T12:00:00.000Z';
const principal={user_id:'fixture',token:'preserved-fixture',role:'premium',expires_at:future,permissions:catalog.tiers.premium.permissions};

test('market and China expire independently while Free remains permanent',()=>{
  for(const marketLive of [true,false]) for(const chinaLive of [true,false]) {
    const source={...principal,subscriptions:{market:{tier:'premium',expires_at:marketLive?future:past},china:{tier:'china',expires_at:chinaLive?future:past}}};
    const state=policy.project(source,{},[],now);
    assert.equal(state.principal.token,principal.token);
    assert.equal(state.permissions.rest.financial,marketLive);
    assert.equal(state.permissions.rest.cn_archive,chinaLive);
    assert.equal(state.permissions.ws.stocks,true);
    assert.equal(state.market_tier,marketLive?'premium':'free');
    assert.equal(policy.isActive(source,now),true);
    assert.deepEqual(policy.project(state.principal,state.account,[],now).principal,state.principal);
  }
});
test('purchase extends its own clock and duplicate fulfillment is idempotent',()=>{
  const premium=policy.applyPurchase({user_id:'fixture',token:'fixed'}, {},{tier:'premium',days:30},'premium-order',now);
  const china=policy.applyPurchase(premium.principal,premium.account,{tier:'china',days:30},'china-order',now+86400000);
  assert.equal(china.market_expiry,premium.market_expiry);
  assert.equal(china.china_expiry,new Date(now+31*86400000).toISOString());
  const repeated=policy.applyPurchase(china.principal,china.account,{tier:'china',days:30},'china-order',now+2*86400000);
  assert.deepEqual(repeated.principal,china.principal);
  const renewed=policy.applyPurchase(china.principal,china.account,{tier:'premium',days:60},'renew-order',now);
  assert.equal(Date.parse(renewed.market_expiry)-Date.parse(premium.market_expiry),60*86400000);
  assert.equal(renewed.china_expiry,china.china_expiry);
});
test('completed old purchases recover stacking before a new purchase',()=>{
  const source={...principal,role:'china',permissions:catalog.tiers.china.permissions};
  const orders=[{id:'old-paid',status:'COMPLETED',payment_status:'PAID',user_id:'fixture',completed_at:'2026-10-01',bundle:{tier:'premium'},account:{expiry:future}}];
  const state=policy.applyPurchase(source,{}, {tier:'china',days:30},'china-renew',now,orders);
  assert.equal(state.permissions.rest.financial,true);assert.equal(state.permissions.rest.cn_archive,true);
  assert.equal(state.market_expiry,future);
  const unpaid=policy.project(source,{},[{...orders[0],payment_status:'UNPAID'}],now);
  assert.equal(unpaid.permissions.rest.financial,false);
});
test('legacy Trial preserves only its original clock, never a new sale',()=>{
  const legacy=policy.project({...principal,role:'trial',expires_at:future},{},[],now);
  assert.equal(legacy.market_expiry,future);assert.equal(legacy.market_tier,'standard');
  assert.throws(()=>policy.applyPurchase(principal,{}, {tier:'trial',days:3},'new',now));
  assert.throws(()=>policy.changeTier(principal,{},'trial',null,[],now));
  const expired=policy.project({...principal,role:'trial',expires_at:past},{},[],now);
  assert.equal(expired.market_tier,'free');assert.equal(expired.expiry,null);
});
test('replacing a credential restores clocks and never creates fresh paid days',()=>{
  const legacy={username:'fixture',tier:'premium',role:'premium',expires_at:past};
  const state=policy.restore(legacy,null,[],now);
  assert.equal(state.market_tier,'free');assert.equal(state.expiry,null);
  const restored=policy.restore({...legacy,subscriptions:{market:{tier:'premium',expires_at:future},china:{tier:'china',expires_at:future}}},null,[],now);
  assert.equal(restored.market_expiry,future);assert.equal(restored.china_expiry,future);
  assert.equal(policy.restore({...legacy,expires_at:undefined},null,[],now).market_tier,'free');
});
test('Value requires scope and malformed grants never grant access',()=>{
  for(const grant of [{tier:'trial',expires_at:future},{tier:'premium',expires_at:null},{tier:'value',expires_at:future},{tier:'premium',expires_at:future,unknown:true},{tier:'premium',expires_at:future,mode:'stocks'},{tier:'premium',expires_at:future,order_id:4}]) {
    assert.equal(policy.validSubscriptions({market:grant}),false);
    assert.equal(policy.isActive({...principal,subscriptions:{market:grant}},now),false);
    assert.throws(()=>policy.project({...principal,subscriptions:{market:grant}},{},[],now));
  }
  for(const mode of ['stocks','options']) {
    const state=policy.applyPurchase(principal,{}, {tier:'value',mode,days:30},'value',now);
    assert.equal(state.permissions.rest.stocks_history,mode==='stocks');
    assert.equal(state.permissions.rest.options_history,mode==='options');
  }
});
test('legacy WS alias and wildcard denials survive migration and future purchases',()=>{
  for(const ws of [{stock:false},{all:false},{'*':false}]) {
    const state=policy.project({...principal,permissions:{ws}},{},[],now);
    assert.equal(state.permissions.ws.stocks,false);
    assert.equal(state.principal.permission_overrides.ws.stocks,false);
    const purchased=policy.applyPurchase(state.principal,state.account,{tier:'standard',days:30},'next',now);
    assert.equal(purchased.permissions.ws.stocks,false);
  }
  const topic=policy.project({...principal,permissions:{ws:{'stock.trades':false,options:{quotes:false}}}},{},[],now);
  assert.equal(topic.principal.permission_overrides.ws['stock.trades'],false);
  assert.deepEqual(topic.principal.permission_overrides.ws.options,{quotes:false});
  // Basic's normal disabled WS is not an operator revocation of Free WS.
  const basic=policy.project({...principal,role:'basic',permissions:catalog.tiers.basic.permissions,expires_at:past},{},[],now);
  assert.equal(basic.permissions.ws.stocks,true);
});
test('manual scoped changes preserve the other subscription and clocks',()=>{
  const source={...principal,subscriptions:{market:{tier:'premium',expires_at:future},china:{tier:'china',expires_at:future}}};
  const extended=policy.extend(source,{},5,'china',[],now);
  assert.equal(extended.market_expiry,future);assert.equal(Date.parse(extended.china_expiry)-Date.parse(future),5*86400000);
  const changed=policy.changeTier(extended.principal,{},'standard',null,[],now);
  assert.equal(changed.china_expiry,extended.china_expiry);assert.equal(changed.market_expiry,future);
  const free=policy.changeTier(changed.principal,{},'free',null,[],now);
  assert.equal(free.market_expiry,null);assert.equal(free.china_expiry,extended.china_expiry);
});
