const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { after, before, test } = require('node:test');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const app = require('../src/app');
const { generateAccessToken } = require('../src/services/jwt.service');
const swaggerSpec = require('../src/config/swagger');

const userId = 'b094b9e4-de81-4fff-864c-d52ce853ff11';
const protectedRoutes = [
  { method: 'GET', path: '/api/v1/users', scope: 'users:read' },
  { method: 'GET', path: `/api/v1/users/${userId}`, scope: 'users:read' },
  { method: 'PATCH', path: `/api/v1/users/${userId}`, scope: 'users:write' },
  { method: 'DELETE', path: `/api/v1/users/${userId}`, scope: 'users:delete' },
  { method: 'GET', path: `/api/v1/cart?userId=${userId}`, scope: 'carts:read' },
  { method: 'PATCH', path: `/api/v1/cart?userId=${userId}`, scope: 'carts:write' },
  { method: 'DELETE', path: `/api/v1/cart?userId=${userId}`, scope: 'carts:delete' }
];

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

const request = (route, token) => fetch(`${baseUrl}${route.path}`, {
  method: route.method,
  headers: token ? { Authorization: `Bearer ${token}` } : undefined
});

test('requires authentication and the matching scope on User and Cart APIs', async () => {
  for (const route of protectedRoutes) {
    const unauthenticated = await request(route);
    assert.equal(unauthenticated.status, 401, `${route.method} ${route.path} without a token`);
    assert.deepEqual(await unauthenticated.json(), { statusCode: 401, message: 'Unauthorized' });

    const malformed = await request(route, 'not-a-jwt');
    assert.equal(malformed.status, 401, `${route.method} ${route.path} with a malformed token`);

    const insufficientToken = generateAccessToken({
      clientId: 'cms-admin',
      scope: 'unrelated:scope'
    });
    const insufficient = await request(route, insufficientToken);
    assert.equal(insufficient.status, 403, `${route.method} ${route.path} without ${route.scope}`);
    assert.deepEqual(await insufficient.json(), {
      error: 'insufficient_scope',
      error_description: 'Required scope is missing'
    });
  }
});

test('a scope for one module does not grant access to another', async () => {
  const productsToken = generateAccessToken({
    clientId: 'cms-admin',
    scope: 'products:write categories:write'
  });

  for (const route of protectedRoutes) {
    const response = await request(route, productsToken);
    assert.equal(response.status, 403, `${route.method} ${route.path} with catalog scopes only`);
  }
});

test('documents the required OAuth scopes on all User and Cart endpoints', () => {
  const expectedScopes = {
    'GET /api/v1/users': 'users:read',
    'GET /api/v1/users/{userId}': 'users:read',
    'PATCH /api/v1/users/{userId}': 'users:write',
    'DELETE /api/v1/users/{userId}': 'users:delete',
    'GET /api/v1/cart': 'carts:read',
    'PATCH /api/v1/cart': 'carts:write',
    'DELETE /api/v1/cart': 'carts:delete'
  };

  for (const [operation, scope] of Object.entries(expectedScopes)) {
    const [method, path] = operation.split(' ');
    assert.deepEqual(
      swaggerSpec.paths[path][method.toLowerCase()].security,
      [{ OAuth2: [scope] }],
      `${operation} must require ${scope}`
    );
  }

  const schemeScopes = swaggerSpec.components.securitySchemes.OAuth2.flows.clientCredentials.scopes;
  for (const scope of Object.values(expectedScopes)) {
    assert.ok(schemeScopes[scope], `OAuth2 scheme must define ${scope}`);
  }
  assert.equal(swaggerSpec.components.securitySchemes.UserBearer, undefined);
});
