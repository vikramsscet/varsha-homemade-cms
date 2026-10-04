const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const { generateAccessToken } = require('../src/services/jwt.service');
const { authenticateOAuthToken } = require('../src/middlewares/oauth-auth.middleware');

const callMiddleware = (authorization) => {
  const req = { headers: {} };
  if (authorization !== undefined) {
    req.headers.authorization = authorization;
  }

  const res = {
    statusCode: undefined,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  let nextCalled = false;
  let nextError;

  authenticateOAuthToken(req, res, (error) => {
    nextCalled = true;
    nextError = error;
  });

  return { req, res, nextCalled, nextError };
};

const assertUnauthorized = (result) => {
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, {
    statusCode: 401,
    message: 'Unauthorized'
  });
  assert.equal(result.nextCalled, false);
};

test('rejects missing, non-Bearer, invalid, and expired tokens generically', () => {
  assertUnauthorized(callMiddleware(undefined));
  assertUnauthorized(callMiddleware('Basic abc123'));
  assertUnauthorized(callMiddleware('Bearer not-a-jwt'));

  const expiredToken = jwt.sign(
    { client_id: 'cms-admin', scope: 'products:read' },
    privateKey,
    {
      algorithm: 'RS256',
      issuer: 'cms-service-test',
      audience: 'cms-api-test',
      subject: 'cms-admin',
      expiresIn: -1
    }
  );
  assertUnauthorized(callMiddleware(`Bearer ${expiredToken}`));
});

test('attaches verified client identity and scopes to the request', () => {
  const token = generateAccessToken({
    clientId: 'cms-admin',
    scope: 'products:read products:write'
  });
  const result = callMiddleware(`Bearer ${token}`);

  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, undefined);
  assert.deepEqual(result.req.auth, {
    clientId: 'cms-admin',
    scopes: ['products:read', 'products:write'],
    sub: 'cms-admin'
  });
  assert.equal(result.res.statusCode, undefined);
});