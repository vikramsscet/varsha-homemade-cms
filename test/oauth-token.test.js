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

const requestToken = (fields) => fetch(`${baseUrl}/api/v1/oauth/token`, {
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
test('rejects missing client ID or client secret as invalid_client', async () => {
  const expected = {
    error: 'invalid_client',
    error_description: 'Invalid client credentials'
  };
  const missingId = await requestToken({
    grant_type: 'client_credentials',
    client_secret: 'test-client-secret'
  });
  const missingSecret = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'cms-admin-test'
  });
  const emptyBoth = await requestToken({
    grant_type: 'client_credentials',
    client_id: '',
    client_secret: ''
  });

  for (const response of [missingId, missingSecret, emptyBoth]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), expected);
  }
});

test('does not read credentials from the Authorization header', async () => {
  const basic = Buffer.from('cms-admin-test:test-client-secret').toString('base64');
  const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_client');
});

test('accepts credentials in a JSON body', async () => {
  const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'cms-admin-test',
      client_secret: 'test-client-secret'
    })
  });

  assert.equal(response.status, 200);
});

test('issues a token narrowed to the requested scope', async () => {
  const response = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'cms-admin-test',
    client_secret: 'test-client-secret',
    scope: 'products:write'
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(jwtService.validateAccessToken(body.access_token).scope, 'products:write');
});

test('rejects unknown, empty, or widening scopes with invalid_scope', async () => {
  for (const scope of ['products:read unknown:scope', 'users:delete', ' ', '']) {
    const response = await requestToken({
      grant_type: 'client_credentials',
      client_id: 'cms-admin-test',
      client_secret: 'test-client-secret',
      scope
    });
    const body = await response.json();

    assert.equal(response.status, 400, `scope ${JSON.stringify(scope)}`);
    assert.equal(body.error, 'invalid_scope');
  }
});

test('checks credentials before scope so bad credentials never reveal scope validity', async () => {
  const response = await requestToken({
    grant_type: 'client_credentials',
    client_id: 'cms-admin-test',
    client_secret: 'wrong-secret',
    scope: 'unknown:scope'
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_client');
});

test('Swagger UI interceptor moves Basic credentials into the token request body', () => {
  const { swaggerOptions } = require('../src/config/swagger-ui');
  const intercept = swaggerOptions.requestInterceptor;
  const basic = Buffer.from('cms-admin:s3cr3t:with:colons').toString('base64');
  // Swagger UI issues this request with a lowercase method.
  const request = {
    method: 'post',
    url: 'http://localhost:3000/api/v1/oauth/token',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=products%3Aread+products%3Awrite'
  };

  const result = intercept(request);
  const params = new URLSearchParams(result.body);

  assert.equal(params.get('grant_type'), 'client_credentials');
  assert.equal(params.get('scope'), 'products:read products:write');
  assert.equal(params.get('client_id'), 'cms-admin');
  assert.equal(params.get('client_secret'), 's3cr3t:with:colons');
  assert.equal(result.headers.Authorization, undefined);
  assert.equal(result.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('Swagger UI interceptor leaves every other request untouched', () => {
  const intercept = require('../src/config/swagger-ui').swaggerOptions.requestInterceptor;
  const bearer = {
    method: 'GET',
    url: 'http://localhost:3000/api/v1/products',
    headers: { Authorization: 'Bearer abc' },
    body: undefined
  };
  const otherBasic = {
    method: 'POST',
    url: 'http://localhost:3000/api/v1/products',
    headers: { Authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
    body: 'x=1'
  };

  assert.deepEqual(intercept({ ...bearer, headers: { ...bearer.headers } }), bearer);
  assert.equal(intercept({ ...otherBasic, headers: { ...otherBasic.headers } }).headers.Authorization, otherBasic.headers.Authorization);
});
