const { createPrivateKey, createPublicKey } = require('node:crypto');
const jwt = require('jsonwebtoken');
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_EXPIRES_IN,
  JWT_PRIVATE_KEY
} = require('../config/env');

const createConfigurationError = (message) => {
  const error = new Error(message);
  error.code = 'JWT_CONFIGURATION_ERROR';
  return error;
};

const getJwtConfiguration = () => {
  if (!JWT_ISSUER || !JWT_AUDIENCE || !JWT_EXPIRES_IN) {
    throw createConfigurationError('JWT issuer, audience, and expiration must be configured');
  }

  const privateKeyPem = JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKeyPem) {
    throw createConfigurationError('JWT private key is not configured');
  }

  try {
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'rsa') {
      throw new Error('JWT signing key must be an RSA private key');
    }

    return {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: JWT_EXPIRES_IN,
      privateKey,
      publicKey: createPublicKey(privateKey)
    };
  } catch {
    throw createConfigurationError('JWT private key must be a valid RSA private key');
  }
};

const generateAccessToken = ({ clientId, scope } = {}) => {
  if (typeof clientId !== 'string' || !clientId.trim()) {
    throw new TypeError('A client ID is required to generate an access token');
  }
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new TypeError('A scope string is required to generate an access token');
  }

  const config = getJwtConfiguration();
  return jwt.sign(
    { client_id: clientId, scope },
    config.privateKey,
    {
      algorithm: 'RS256',
      issuer: config.issuer,
      audience: config.audience,
      subject: clientId,
      expiresIn: config.expiresIn
    }
  );
};

const validateAccessToken = (token) => {
  const config = getJwtConfiguration();
  const payload = jwt.verify(token, config.publicKey, {
    algorithms: ['RS256'],
    issuer: config.issuer,
    audience: config.audience
  });

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.client_id !== 'string' ||
    payload.sub !== payload.client_id ||
    typeof payload.scope !== 'string' ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    throw new jwt.JsonWebTokenError('Invalid access token payload');
  }

  return payload;
};

module.exports = {
  generateAccessToken,
  validateAccessToken
};