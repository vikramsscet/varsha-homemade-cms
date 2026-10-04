const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
});

process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const jwtService = require('../src/services/jwt.service');

test('generates and validates an RS256 access token with the configured claims', () => {
  const token = jwtService.generateAccessToken({
    clientId: 'cms-admin',
    scope: 'products:read products:write'
  });
  const decoded = jwt.decode(token);

  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'RS256');
  assert.equal(decoded.iss, 'cms-service-test');
  assert.equal(decoded.sub, 'cms-admin');
  assert.equal(decoded.aud, 'cms-api-test');
  assert.equal(decoded.client_id, 'cms-admin');
  assert.equal(decoded.scope, 'products:read products:write');
  assert.equal(decoded.exp - decoded.iat, 15 * 60);
  assert.deepEqual(jwtService.validateAccessToken(token), decoded);
});

test('rejects tampered and expired access tokens', () => {
  const token = jwtService.generateAccessToken({
    clientId: 'cms-admin',
    scope: 'products:read'
  });
  const [header, payload, signature] = token.split('.');
  const tamperedToken = `${header}.${payload}.${signature.slice(0, -1)}x`;
  assert.throws(() => jwtService.validateAccessToken(tamperedToken), jwt.JsonWebTokenError);

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
  assert.throws(() => jwtService.validateAccessToken(expiredToken), jwt.TokenExpiredError);
});