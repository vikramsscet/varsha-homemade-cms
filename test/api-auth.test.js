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

const protectedRoutes = [
  { method: 'POST', path: '/api/v1/products', scope: 'products:write' },
  { method: 'PATCH', path: '/api/v1/products/product-id', scope: 'products:write' },
  { method: 'DELETE', path: '/api/v1/products/product-id', scope: 'products:delete' },
  { method: 'GET', path: '/api/v1/products/product-id', scope: 'products:read' },
  { method: 'POST', path: '/api/v1/products/product-id/images', scope: 'products:write' },
  { method: 'GET', path: '/api/v1/products/product-id/images', scope: 'products:read' },
  { method: 'DELETE', path: '/api/v1/products/product-id/images/image-id', scope: 'products:delete' },
  { method: 'POST', path: '/api/v1/categories', scope: 'categories:write' },
  { method: 'GET', path: '/api/v1/categories/category-id', scope: 'categories:read' },
  { method: 'PATCH', path: '/api/v1/categories/category-id', scope: 'categories:write' },
  { method: 'DELETE', path: '/api/v1/categories/category-id', scope: 'categories:delete' }
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

test('requires authentication and the matching scope on protected Product and Category APIs', async () => {
  for (const route of protectedRoutes) {
    const unauthenticated = await request(route);
    assert.equal(unauthenticated.status, 401, `${route.method} ${route.path} without a token`);

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

test('documents required scopes and leaves catalog collections public', () => {
  const expectedScopes = {
    'POST /api/v1/products': 'products:write',
    'PATCH /api/v1/products/{id}': 'products:write',
    'DELETE /api/v1/products/{id}': 'products:delete',
    'GET /api/v1/products/{id}': 'products:read',
    'POST /api/v1/categories': 'categories:write',
    'GET /api/v1/categories/{id}': 'categories:read',
    'PATCH /api/v1/categories/{id}': 'categories:write',
    'DELETE /api/v1/categories/{id}': 'categories:delete'
  };

  for (const [operation, scope] of Object.entries(expectedScopes)) {
    const [method, path] = operation.split(' ');
    assert.deepEqual(swaggerSpec.paths[path][method.toLowerCase()].security, [{ OAuth2: [scope] }]);
  }

  assert.equal(swaggerSpec.paths['/api/v1/products'].get.security, undefined);
  assert.equal(swaggerSpec.paths['/api/v1/categories'].get.security, undefined);
  assert.equal(swaggerSpec.paths['/oauth/token'].post.security, undefined);
});