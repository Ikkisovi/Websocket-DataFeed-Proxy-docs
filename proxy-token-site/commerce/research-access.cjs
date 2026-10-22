'use strict';
// Research reports are included from the Basic plan up. The effective role comes from the
// subscription projection, so an expired plan reads as free and is locked out.
const DEFAULT_ROLES = ['basic', 'value', 'standard', 'premium', 'trial', 'test', 'unrestricted'];

function allowedRoles(env = process.env) {
  const configured = String(env.RESEARCH_ALLOWED_ROLES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ROLES);
}

function evaluate(role, env = process.env) {
  const normalized = String(role || '').trim().toLowerCase() || 'free';
  return { allowed: allowedRoles(env).has(normalized), role: normalized };
}

module.exports = { DEFAULT_ROLES, allowedRoles, evaluate };
