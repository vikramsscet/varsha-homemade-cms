const assert = require('node:assert/strict');
const { test } = require('node:test');

const pricing = require('../src/cart/cart.pricing');

test('calculates item totals in minor units without floating point drift', () => {
  assert.equal(pricing.calculateItemTotal('599.00', 3), '1797.00');
  assert.equal(pricing.calculateItemTotal(0.1, 3), '0.30');
  assert.equal(pricing.normalizeMoney('500'), '500.00');
});

test('recomputes cart totals from item rows and ignores client amounts', () => {
  const items = [
    { unitPrice: '500.00', quantity: 2 },
    { unitPrice: '599.00', quantity: 1 }
  ];
  assert.deepEqual(pricing.calculateTotals(items), {
    subtotal: '1599.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '1599.00'
  });
  assert.deepEqual(pricing.calculateTotals([]), {
    subtotal: '0.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '0.00'
  });
});

test('rejects invalid cart update payloads before touching the database', async () => {
  const cartService = require('../src/cart/cart.service');
  const invalidPayloads = [
    undefined,
    null,
    [],
    {},
    { items: [] },
    { items: 'nope' },
    { items: [{ productId: 'not-a-uuid', quantity: 1 }] },
    { items: [{ productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 1.5 }] },
    { items: [{ productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: -1 }] },
    { items: [{ productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 100 }] },
    { items: [{ productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 1, unitPrice: 1 }] },
    { totals: { subtotal: 0 }, items: [{ productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 1 }] },
    {
      items: [
        { productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 1 },
        { productId: '72b91880-c947-4323-a045-67ba0955a133', quantity: 2 }
      ]
    }
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      cartService.updateCart('b094b9e4-de81-4fff-864c-d52ce853ff11', payload),
      (error) => error.statusCode === 400,
      `payload ${JSON.stringify(payload)} must be rejected with 400`
    );
  }
});

test('rejects invalid userId values before touching the database', async () => {
  const cartService = require('../src/cart/cart.service');
  for (const userId of [undefined, '', 'not-a-uuid', 'cms-admin', 42]) {
    await assert.rejects(
      cartService.resolveUserId(userId),
      (error) => error.statusCode === 400 && error.code === 'INVALID_USER_ID',
      `userId ${JSON.stringify(userId)} must be rejected with 400`
    );
  }
});

test('rejects protected and unknown fields on user updates before touching the database', async () => {
  const userService = require('../src/users/user.service');
  const userId = 'b094b9e4-de81-4fff-864c-d52ce853ff11';
  const invalidPayloads = [
    undefined,
    null,
    {},
    { email: 'new@example.com' },
    { id: 'other-id' },
    { status: 'DELETED' },
    { status: 'nonsense' },
    { emailVerified: true },
    { googleId: '123' },
    { role: 'admin' },
    { firstName: '' },
    { firstName: 'x'.repeat(256) },
    { profileImageUrl: 'javascript:alert(1)' },
    { profileImageUrl: 'not a url' }
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      userService.updateUser(userId, payload),
      (error) => error.statusCode === 400,
      `payload ${JSON.stringify(payload)} must be rejected with 400`
    );
  }

  await assert.rejects(
    userService.updateUser('not-a-uuid', { displayName: 'x' }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_USER_ID'
  );
});
