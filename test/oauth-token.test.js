const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { after, before, test } = require('node:test');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

process.env.CMS_OAUTH_CLIENT_ID = 'cms-admin-test';
process.env.CMS_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.CMS_OAUTH_SCOPES = 'products:read,products:write';
process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const app = require('../src/app');
const jwtService = require('../src/services/jwt.service');
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const requestToken = (fields) => fetch(`${baseUrl}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields)
});

test('issues a 15-minute bearer access token for valid client credentials', async () => {
  const response = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'cms-admin-test',
    client_secret: 'test-client-secret'
  });
  const body = await response.json();
  const payload = jwtService.validateAccessToken(body.access_token);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['access_token', 'expires_in', 'token_type']);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 900);
  assert.equal(payload.client_id, 'cms-admin-test');
  assert.equal(payload.scope, 'products:read products:write');
  assert.equal(payload.exp - payload.iat, 900);
});

test('returns the same invalid-client error for an incorrect ID or secret', async () => {
  const expected = {
    error: 'invalid_client',
    error_description: 'Invalid client credentials'
  };
  const invalidIdResponse = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'wrong-id',
    client_secret: 'test-client-secret'
  });
  const invalidSecretResponse = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'cms-admin-test',
    client_secret: 'wrong-secret'
  });

  assert.equal(invalidIdResponse.status, 401);
  assert.deepEqual(await invalidIdResponse.json(), expected);
  assert.equal(invalidSecretResponse.status, 401);
  assert.deepEqual(await invalidSecretResponse.json(), expected);
});

test('rejects unsupported and missing grant types', async () => {
  const expected = {
    error: 'unsupported_grant_type',
    error_description: 'Only client_credentials grant type is supported'
  };
  const unsupportedResponse = await requestToken({ grant_type: 'password' });
  const missingResponse = await requestToken({ client_id: 'cms-admin-test' });

  assert.equal(unsupportedResponse.status, 400);
  assert.deepEqual(await unsupportedResponse.json(), expected);
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), expected);
});