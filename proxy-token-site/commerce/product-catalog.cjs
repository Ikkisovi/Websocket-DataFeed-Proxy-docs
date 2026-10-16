'use strict';
// Commercial definitions are shared by checkout, fulfillment and public docs.
const catalog = require('./product-catalog.json');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sourceBytes = fs.readFileSync(path.join(__dirname, 'product-catalog.json'));
const catalogSHA256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');

function validateCatalog(value) {
  if (value.schema_version !== 1 || !value.version || !value.tiers || !value.plan_details) throw new Error('Unknown commercial catalog');
  for (const [tier, details] of Object.entries(value.plan_details)) {
    const definition = value.tiers[tier];
    if (!definition || !definition.role || !Array.isArray(details.features)) throw new Error('Invalid plan ' + tier);
    for (const prices of [value.monthly_prices_cny_minor, value.monthly_prices_usd_minor]) {
      if (!Number.isSafeInteger(prices[tier]) || prices[tier] <= 0) throw new Error('Invalid plan price ' + tier);
    }
    for (const mode of details.modes || []) if (!definition.modes?.[mode]) throw new Error('Unknown plan scope');
  }
  for (const months of value.duration_months) if (!Number.isSafeInteger(months) || months < 1) throw new Error('Invalid subscription duration');
}
validateCatalog(catalog);

function resolvePermissions(tierConfig, mode) {
  return structuredClone(tierConfig.modes?.[mode] || tierConfig.permissions);
}
function buildPaymentBundles() {
  const bundles = {};
  for (const [tier, details] of Object.entries(catalog.plan_details)) {
    for (const mode of details.modes || [null]) {
      for (const months of catalog.duration_months) {
        const id = [tier, mode, `${months}m`].filter(Boolean).join('-');
        const definition = catalog.tiers[tier];
        bundles[id] = { id, tier, mode, months, days: months * (definition.expiryDays || 30),
          currency: 'CNY', amount_cny_fen: catalog.monthly_prices_cny_minor[tier] * months,
          monthly_amount_cny_fen: catalog.monthly_prices_cny_minor[tier], role: definition.role,
          permissions: resolvePermissions(definition, mode), name: details.name,
          summary: details.summary, features: details.features, renewal_only: details.renewal_only === true,
          catalog_version: catalog.version, catalog_sha256: catalogSHA256 };
      }
    }
  }
  return bundles;
}
function resolveEffectivePermissions(principal) {
  const tier = catalog.tiers[String(principal.role || '').toLowerCase()];
  if (!tier) return { rest: {}, ws: {} };
  const scoped = principal.permissions?.rest && typeof principal.permissions.rest === 'object';
  const variants = tier.modes && !principal.mode && scoped ? Object.values(tier.modes) : [tier.modes?.[principal.mode] || tier.permissions];
  const result = { rest: {}, ws: {} };
  for (const group of ['rest', 'ws']) {
    const keys = new Set(variants.flatMap(value => Object.keys(value[group] || {})));
    for (const key of keys) {
      const maximum = variants.some(value => value[group]?.[key] === true);
      const explicitGroup = principal.permissions?.[group];
      const explicit = explicitGroup?.[key];
      result[group][key] = maximum && explicitGroup !== false && explicit !== false;
      if (explicitGroup && typeof explicitGroup === 'object' && !Object.hasOwn(explicitGroup, key)) {
        // Older records lack newly introduced capability keys; role fallback is
        // bounded by the commercial maximum, never an arbitrary registry allow.
        result[group][key] = maximum;
      }
    }
  }
  return result;
}
function publicCatalog() {
  const visible = new Set(['free', ...Object.keys(catalog.plan_details)]);
  return { schema_version: catalog.schema_version, version: catalog.version, sha256: catalogSHA256,
    duration_months: catalog.duration_months, retired_products: catalog.retired_products,
    subscription_semantics: catalog.subscription_semantics, free_baseline_permanent: true,
    tiers: Object.fromEntries(Object.entries(catalog.tiers).filter(([name]) => visible.has(name))),
    plan_details: catalog.plan_details,
    monthly_prices_cny_minor: catalog.monthly_prices_cny_minor,
    monthly_prices_usd_minor: catalog.monthly_prices_usd_minor };
}
module.exports = { catalog, catalogSHA256, validateCatalog, resolvePermissions, buildPaymentBundles, publicCatalog, resolveEffectivePermissions };
