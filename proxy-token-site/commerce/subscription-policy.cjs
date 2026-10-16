'use strict';
const { catalog, catalogSHA256, resolvePermissions } = require('./product-catalog.cjs');
const { isDeepStrictEqual } = require('node:util');
const MARKET = new Set(catalog.subscription_groups.market);
const NORMAL = new Set([...MARKET, 'china', 'trial']);
const clone = value => structuredClone(value);
const active = (grant, now) => grant && (grant.tier === 'free' || Date.parse(grant.expires_at) > now);
const empty = value => !value || !Object.values(value).some(group => Object.keys(group || {}).length);
function validClock(value) {
  if(typeof value!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const date=value.slice(0,10);
  return new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
}

function validSubscriptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [group, grant] of Object.entries(value)) {
    if (!['market','china'].includes(group) || !grant || typeof grant !== 'object' || Array.isArray(grant)) return false;
    if (group === 'market' ? !MARKET.has(grant.tier) : grant.tier !== 'china') return false;
    if (Object.keys(grant).some(key => !['tier','expires_at','mode','order_id'].includes(key))) return false;
    if (grant.order_id !== undefined && (typeof grant.order_id !== 'string' || !grant.order_id.trim())) return false;
    if (grant.tier !== 'free' && !validClock(grant.expires_at)) return false;
    if (grant.tier === 'free' && grant.expires_at !== null) return false;
    if (grant.tier === 'value' ? !['stocks','options'].includes(grant.mode) : grant.mode !== undefined) return false;
  }
  return true;
}
function legacyMode(principal, account) {
  if (['stocks','options'].includes(account?.mode || principal.mode)) return account?.mode || principal.mode;
  const p = principal.permissions?.rest;
  return p?.options_history === true && p?.stocks_history !== true ? 'options' : 'stocks';
}
function latestPurchase(orders, group, userId) {
  return orders.filter(o => o.status === 'COMPLETED' && o.payment_status === 'PAID'
    && (o.user_id || o.account?.user_id) === userId
    && (o.bundle?.tier === 'china' ? 'china' : 'market') === group
    && (group === 'china' || MARKET.has(o.bundle?.tier))
    && Number.isFinite(Date.parse(o.account?.expiry)))
    .sort((a,b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0];
}
function purchaseGrant(order) {
  return { tier: order.bundle.tier, ...(order.bundle.tier==='value' ? {mode:order.bundle.mode || 'stocks'} : {}),
    expires_at: order.account.expiry, order_id: order.id };
}
function bootstrap(principal, account = {}, orders = []) {
  if (principal.subscriptions !== undefined) {
    if (!validSubscriptions(principal.subscriptions)) throw new Error('Invalid existing subscription grants');
    return clone(principal.subscriptions);
  }
  const role = String(principal.role || '').toLowerCase();
  if (!NORMAL.has(role)) return null;
  if (principal.expires_at !== undefined && principal.expires_at !== null && !validClock(principal.expires_at)) return null;
  const value = {market:{tier:'free',expires_at:null}};
  const expiry = principal.expires_at;
  if (role === 'china' && Number.isFinite(Date.parse(expiry))) value.china={tier:'china',expires_at:expiry};
  else if (role !== 'free' && Number.isFinite(Date.parse(expiry))) {
    const tier=role==='trial'?'standard':role;
    value.market={tier,...(tier==='value'?{mode:legacyMode(principal,account)}:{}),expires_at:expiry};
  }
  const china = latestPurchase(orders,'china',principal.user_id);
  if (!value.china && china) value.china=purchaseGrant(china);
  // A China purchase used to replace the US role. Recover only an exact,
  // completed market purchase; never infer a grant from an abandoned order.
  if (role === 'china') {
    const market=latestPurchase(orders,'market',principal.user_id);
    if (market) value.market=purchaseGrant(market);
  }
  return value;
}
function maximum(subscriptions, now) {
  if (!validSubscriptions(subscriptions)) throw new Error('Invalid subscription grants');
  const grant=active(subscriptions.market,now)?subscriptions.market:{tier:'free',expires_at:null};
  const definition=catalog.tiers[grant.tier];
  const permissions=resolvePermissions(definition,grant.mode || (grant.tier==='value'?'stocks':null));
  if (active(subscriptions.china,now)) permissions.rest.cn_archive=true;
  return {grant,permissions,china:active(subscriptions.china,now)?subscriptions.china:null};
}
function legacyOverrides(principal, subscriptions, now) {
  if (principal.permission_overrides !== undefined) return clone(principal.permission_overrides);
  const overrides={rest:{},ws:{}};
  // Only a denial beyond the selected commercial plan is a user override.
  // An ordinary Basic ws=false must not survive as a denial after Free fallback.
  let reference;
  const role=String(principal.role || '').toLowerCase();
  const def=catalog.tiers[role] || catalog.legacy_tiers[role];
  if (def) reference=resolvePermissions(def,role==='value'?legacyMode(principal):null);
  else reference=maximum(subscriptions,now).permissions;
  const wsAliases={stock:'stocks',option:'options',boat:'boats'};
  for (const group of ['rest','ws']) {
    if (principal.permissions?.[group] === false) {
      for (const [key, allowed] of Object.entries(reference[group] || {})) if (allowed) overrides[group][key]=false;
    } else for (const [rawKey, value] of Object.entries(principal.permissions?.[group] || {})) {
      const key=group==='ws'?(wsAliases[rawKey] || rawKey):rawKey;
      if (group==='ws' && ['all','*'].includes(key) && value===false) {
        for (const channel of Object.keys(reference.ws || {})) overrides.ws[channel]=false;
      }
      if (value===false && reference[group]?.[key]===true) overrides[group][key]=false;
      else if (group==='ws' && value && typeof value==='object' && overrides.ws[key]!==false) overrides.ws[key]=clone(value);
      else if (group==='ws' && value===false && key.includes('.')) overrides.ws[key]=false;
    }
  }
  if(principal.permissions?.ws?.all===false || principal.permissions?.ws?.['*']===false) for(const channel of Object.keys(reference.ws || {})) overrides.ws[channel]=false;
  return empty(overrides)?null:overrides;
}
function narrow(permissions, overrides) {
  for (const group of ['rest','ws']) {
    if (overrides?.[group]===false) for (const key of Object.keys(permissions[group])) permissions[group][key]=false;
    else for (const [key,value] of Object.entries(overrides?.[group] || {})) {
      if (value===false && key in permissions[group]) permissions[group][key]=false;
      // Nested topic restrictions are retained for the WS gateway.
      else if (group==='ws' && value && typeof value==='object' && permissions.ws[key]) permissions.ws[key]=clone(value);
    }
  }
  return permissions;
}
function project(principal, account = {}, orders = [], now = Date.now()) {
  const subscriptions=bootstrap(principal,account,orders);
  if (!subscriptions) return {principal:clone(principal),account:clone(account),changed:false,managed:false};
  const {grant,permissions,china}=maximum(subscriptions,now);
  const overrides=legacyOverrides(principal,subscriptions,now);
  const next=clone(principal);next.subscriptions=subscriptions;
  next.role=grant.tier==='free' && china?'china':catalog.tiers[grant.tier].role;
  next.permissions=narrow(permissions,overrides);
  next.product_catalog_version=catalog.version;next.product_catalog_sha256=catalogSHA256;
  const primaryExpiry=grant.tier==='free'?china?.expires_at || null:grant.expires_at;
  if (primaryExpiry) next.expires_at=primaryExpiry;else delete next.expires_at;
  if (overrides) next.permission_overrides=overrides;else delete next.permission_overrides;
  const local={...clone(account),role:next.role,tier:grant.tier==='free' && china?'china':grant.tier,
    subscriptions:clone(subscriptions),permissions:clone(next.permissions),
    product_catalog_version:catalog.version,product_catalog_sha256:catalogSHA256};
  if (grant.mode) local.mode=grant.mode;else delete local.mode;
  // expires_at is a compatibility display projection, never credential validity
  // for managed records. REST and WS evaluate each subscription clock directly.
  if (primaryExpiry) local.expires_at=primaryExpiry;else delete local.expires_at;
  return {principal:next,account:local,changed:!isDeepStrictEqual(next,principal)||!isDeepStrictEqual(local,account),managed:true,
    subscriptions,permissions:next.permissions,market_tier:grant.tier,market_expiry:grant.tier==='free'?null:grant.expires_at,
    china_expiry:china?.expires_at || null,expiry:grant.tier==='free'?china?.expires_at || null:grant.expires_at};
}
function applyPurchase(principal, account, bundle, orderId, now = Date.now(), orders = []) {
  if (bundle.tier==='trial' || !catalog.plan_details[bundle.tier]) throw new Error('Product is not sold');
  const subscriptions=bootstrap(principal,account,orders) || {market:{tier:'free',expires_at:null}};
  const group=bundle.tier==='china'?'china':'market';
  if (subscriptions[group]?.order_id===orderId) return project({...principal,subscriptions},account,[],now);
  const previous=subscriptions[group];
  const start=active(previous,now) && previous.tier!=='free'?Date.parse(previous.expires_at):now;
  const expires_at=new Date(start+bundle.days*86400000).toISOString();
  const overrides=legacyOverrides(principal,subscriptions,now);
  subscriptions[group]={tier:bundle.tier,...(bundle.mode?{mode:bundle.mode}:{}),expires_at,order_id:orderId};
  const updated={...principal,subscriptions,...(overrides?{permission_overrides:overrides}:{})};
  return project(updated,account,[],now);
}
function isActive(principal, now = Date.now()) {
  if (principal.subscriptions !== undefined) return validSubscriptions(principal.subscriptions);
  if (String(principal.role).toLowerCase()==='free') return principal.expires_at==null || validClock(principal.expires_at);
  return !principal.expires_at || (Number.isFinite(Date.parse(principal.expires_at)) && Date.parse(principal.expires_at)>now);
}
// Restore only persisted clocks. A replacement credential is never a purchase.
function restore(account, principal, orders = [], now = Date.now()) {
  const source=principal || {user_id:account.account_id || account.username,role:account.role || account.tier || 'free',
    permissions:account.permissions,...(account.expires_at?{expires_at:account.expires_at}:{}),
    ...(account.subscriptions!==undefined?{subscriptions:account.subscriptions}:{}),
    ...(account.permission_overrides!==undefined?{permission_overrides:account.permission_overrides}:{})};
  const subscriptions=bootstrap(source,account,orders);
  if (!subscriptions) throw new Error('Account has no restorable commercial subscription');
  if (!principal && source.subscriptions===undefined && !source.expires_at) {
    const market=latestPurchase(orders,'market',source.user_id);
    if (market) subscriptions.market=purchaseGrant(market);
  }
  return project({...source,subscriptions},account,orders,now);
}
function changeTier(principal, account, tier, mode, orders=[], now=Date.now()) {
  if (tier==='trial' || !catalog.tiers[tier] || tier==='test') throw new Error('Invalid commercial plan');
  if (tier==='value' && !['stocks','options'].includes(mode)) throw new Error('Value requires stocks or options scope');
  const subscriptions=bootstrap(principal,account,orders) || {market:{tier:'free',expires_at:null}};
  const group=tier==='china'?'china':'market';
  const expiry=subscriptions[group]?.expires_at || principal.expires_at;
  subscriptions[group]={tier,...(tier==='value'?{mode}:{}),expires_at:tier==='free'?null:(expiry || new Date(now+30*86400000).toISOString())};
  return project({...principal,subscriptions},account,orders,now);
}
function extend(principal, account, days, requestedGroup, orders=[], now=Date.now()) {
  const subscriptions=bootstrap(principal,account,orders);
  const group=requestedGroup || (subscriptions?.market?.tier!=='free' && subscriptions?.market?'market':'china');
  if (!['market','china'].includes(group) || !subscriptions?.[group] || subscriptions[group].tier==='free') throw new Error('Choose an existing paid subscription');
  const grant=subscriptions[group];
  grant.expires_at=new Date(Math.max(now,Date.parse(grant.expires_at))+days*86400000).toISOString();
  return {...project({...principal,subscriptions},account,orders,now),extended_group:group,extended_expiry:grant.expires_at};
}
module.exports={validSubscriptions,bootstrap,maximum,project,applyPurchase,isActive,restore,changeTier,extend};
