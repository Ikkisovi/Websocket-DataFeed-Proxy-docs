'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { catalog, catalogSHA256, validateCatalog, buildPaymentBundles, publicCatalog, resolveEffectivePermissions } = require('./product-catalog.cjs');

test('existing purchase IDs, integer prices and durations survive extraction', () => {
  const bundles = buildPaymentBundles();
  assert.equal(Object.keys(bundles).length, 30);
  for (const [plan, price] of Object.entries({ basic: 6000, value: 7000, standard: 10000, premium: 15000, china: 7000 })) {
    for (const mode of plan === 'value' ? ['stocks','options'] : [null]) {
      for (const months of [1,2,3,6,12]) {
        const id = [plan,mode,`${months}m`].filter(Boolean).join('-');
        const bundle = bundles[id];
        assert.equal(bundle.amount_cny_fen, price * months);
        assert.equal(bundle.days, 30 * months);
        assert.equal(bundle.catalog_sha256, catalogSHA256);
      }
    }
  }
});

test('public policy has a source fingerprint and excludes internal test plans', () => {
  assert.match(publicCatalog().sha256, /^[a-f0-9]{64}$/);
  assert.equal(publicCatalog().tiers.test, undefined);
  assert.equal(publicCatalog().tiers.free.expiryDays,undefined);
  assert.equal(publicCatalog().tiers.free.permanent,true);
  assert.equal(Object.keys(publicCatalog().tiers.free.permissions.ws).length,6);
  assert.equal(publicCatalog().tiers.free.permissions.rest.admin_token_lookup,undefined);
  assert.equal(publicCatalog().monthly_prices_cny_minor.premium, 15000);
});

test('invalid prices are rejected before checkout can advertise them', () => {
  const bad = structuredClone(catalog);bad.monthly_prices_cny_minor.premium=1.5;
  assert.throws(() => validateCatalog(bad), /Invalid plan price/);
});

test('value scope and explicit negative grants survive policy projection', () => {
  const stock=resolveEffectivePermissions({role:'value',permissions:catalog.tiers.value.modes.stocks});
  const option=resolveEffectivePermissions({role:'value',permissions:catalog.tiers.value.modes.options});
  assert.equal(stock.rest.stocks_history,true);assert.equal(stock.rest.options_history,false);
  assert.equal(option.rest.stocks_history,false);assert.equal(option.rest.options_history,true);
  const legacy=resolveEffectivePermissions({role:'value'});
  assert.equal(legacy.rest.stocks_history,true);assert.equal(legacy.rest.options_history,false);
  const denied=resolveEffectivePermissions({role:'basic',permissions:{ws:{stocks:true}}});
  assert.equal(denied.ws.stocks,false);
});
