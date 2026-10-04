const assert = require('node:assert/strict');
const { test } = require('node:test');
const { requireScope } = require('../src/middlewares/oauth-scope.middleware');

const callMiddleware = (scope, auth) => {
  const req = { auth };
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

  requireScope(scope)(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
};

test('allows a request when the authenticated client has the required scope', () => {
  const result = callMiddleware('products:read', {
    clientId: 'cms-admin',
    scopes: ['products:read', 'products:write']
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, undefined);
});

test('returns the OAuth insufficient_scope response when the required scope is missing', () => {
  const result = callMiddleware('products:delete', {
    clientId: 'cms-admin',
    scopes: ['products:read', 'products:write']
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.deepEqual(result.res.body, {
    error: 'insufficient_scope',
    error_description: 'Required scope is missing'
  });
});

test('returns unauthorized when no authenticated client is attached', () => {
  const result = callMiddleware('products:read', undefined);

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, {
    statusCode: 401,
    message: 'Unauthorized'
  });
});