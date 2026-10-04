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

const issueClientCredentialsToken = ({ clientId, clientSecret } = {}) => {
    console.log('issueClientCredentialsToken called with:', { clientId, clientSecret, CMS_OAUTH_CLIENT_ID, CMS_OAUTH_CLIENT_SECRET });    
  const clientIdMatches = secureEqual(clientId, CMS_OAUTH_CLIENT_ID);
  const clientSecretMatches = secureEqual(clientSecret, CMS_OAUTH_CLIENT_SECRET);

  if (!clientIdMatches || !clientSecretMatches) {
    return null;
  }

  const scope = (CMS_OAUTH_SCOPES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' ');

  return generateAccessToken({
    clientId: CMS_OAUTH_CLIENT_ID,
    scope
  });
};

module.exports = {
  issueClientCredentialsToken
};