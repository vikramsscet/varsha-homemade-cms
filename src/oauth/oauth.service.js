const { createHash, timingSafeEqual } = require('node:crypto');
const { generateAccessToken } = require('../services/jwt.service');
const {
  CMS_OAUTH_CLIENT_ID,
  CMS_OAUTH_CLIENT_SECRET,
  CMS_OAUTH_SCOPES
} = require('../config/env');

const secureEqual = (provided, expected) => {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

const getConfiguredScopes = () => (CMS_OAUTH_SCOPES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const createInvalidScopeError = () => {
  const error = new Error('The requested scope is invalid, unknown, or exceeds the scope granted to the client');
  error.code = 'INVALID_SCOPE';
  return error;
};

// No scope parameter keeps the existing behavior (every configured scope).
// A requested scope may only narrow the configured scopes, never widen them.
const resolveScopes = (requestedScope) => {
  const configured = getConfiguredScopes();
  if (requestedScope === undefined) {
    return configured;
  }

  const requested = typeof requestedScope === 'string'
    ? [...new Set(requestedScope.split(/\s+/).filter(Boolean))]
    : [];
  if (requested.length === 0 || requested.some((scope) => !configured.includes(scope))) {
    throw createInvalidScopeError();
  }

  return requested;
};

// Returns null for invalid client credentials, throws INVALID_SCOPE for a bad
// scope request. Credentials are always checked first so an unauthenticated
// caller learns nothing about which scopes exist.
const issueClientCredentialsToken = ({ clientId, clientSecret, scope } = {}) => {
  const clientIdMatches = secureEqual(clientId, CMS_OAUTH_CLIENT_ID);
  const clientSecretMatches = secureEqual(clientSecret, CMS_OAUTH_CLIENT_SECRET);

  if (!clientIdMatches || !clientSecretMatches) {
    return null;
  }

  return generateAccessToken({
    clientId: CMS_OAUTH_CLIENT_ID,
    scope: resolveScopes(scope).join(' ')
  });
};

module.exports = {
  issueClientCredentialsToken
};
