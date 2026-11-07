const assert = require('node:assert/strict');
const { test } = require('node:test');

const prisma = require('../src/config/database');
const repository = require('../src/orders/order.repository');
const cursorUtil = require('../src/orders/order.cursor');
const { toOrderListItem } = require('../src/orders/order.db-mapper');

const USER_ID = 'b094b9e4-de81-4fff-864c-d52ce853ff11';
const ORDER_ID = '0b0a6c34-0f4e-4b9b-9d39-5d3c1f0a1111';

const listRow = (n, overrides = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  order_number: `VH261106-1000${n}`,
  status: 'PAID',
  currency: 'INR',
  subtotal: '500.00', discount_amount: '0.00', tax_amount: '0.00', shipping_amount: '50.00', total_amount: '550.00',
  user_id: USER_ID, customer_email: 'u@example.com', customer_phone: '+911234567890',
  created_at: new Date('2026-11-06T10:00:00Z'), paid_at: null,
  user_first_name: 'Vik', user_last_name: 'Rao',
  cursor_created_at: `2026-11-06T10:00:0${n}.123456Z`,
  payment_status: 'CAPTURED', payment_method: 'card', card_network: 'VISA', card_last4: '4242',
  bank_code: null, wallet_name: null, upi_handle_masked: null,
  ...overrides
});

// Captures every statement; the mock only ever sees SELECT text from $queryRaw.
const mockQueries = (t, handler = () => []) => {
  const calls = [];
  const original = Object.getOwnPropertyDescriptor(prisma, '$queryRaw');
  Object.defineProperty(prisma, '$queryRaw', {
    configurable: true,
    writable: true,
    value: async (fragment) => {
      calls.push({ sql: fragment.text, values: fragment.values });
      return handler(fragment.text, fragment.values);
    }
  });
  t.after(() => {
    if (original) Object.defineProperty(prisma, '$queryRaw', original);
    else delete prisma.$queryRaw;
  });
  return calls;
};

const assertReadOnly = (calls) => {
  for (const call of calls) {
    assert.match(call.sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  }
};

test('lists registered-user orders with guest exclusion, keyset ordering and a latest-payment lateral join', async (t) => {
  const calls = mockQueries(t, () => [listRow(3), listRow(2), listRow(1)]);
  const page = await repository.findAllUserOrders({ status: 'PAID', search: '50%_x' }, { limit: 2 });

  const [{ sql, values }] = calls;
  assert.match(sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
  assert.match(sql, /ORDER BY o\.created_at DESC, o\.id DESC/);
  assert.match(sql, /ORDER BY attempt_number DESC\s+LIMIT 1/);
  assert.equal(/OFFSET/i.test(sql), false);
  assert.equal(sql.includes('50%'), false, 'search text is never in the SQL text');
  assert.ok(sql.includes("ESCAPE '\\'"), 'LIKE escape character is a single backslash');
  assert.ok(values.includes('PAID'));
  assert.ok(values.includes('50\\%\\_x%'), 'LIKE wildcards are escaped');
  assert.equal(values[values.length - 1], 3, 'fetches limit + 1 rows');
  assertReadOnly(calls);

  assert.equal(page.items.length, 2);
  assert.equal('cursorCreatedAt' in page.items[0], false);
  assert.equal(page.pagination.hasMore, true);
  assert.equal(page.items[0].customer.customerType, 'REGISTERED');
  assert.equal(page.items[0].subtotal, 500);
  assert.equal(page.items[0].paymentMethodSummary, 'Visa •••• 4242');
  assert.deepEqual(Object.keys(page.items[0].latestPayment), ['status', 'method', 'cardNetwork', 'cardLast4', 'bankCode', 'walletName', 'upiHandleMasked']);
});

test('cursor continues strictly after the last row, is opaque and bound to the filters', async (t) => {
  const calls = mockQueries(t, () => [listRow(3), listRow(2), listRow(1)]);
  const first = await repository.findAllUserOrders({ status: 'PAID' }, { limit: 2 });
  const { nextCursor } = first.pagination;
  assert.match(nextCursor, /^[A-Za-z0-9_-]+$/);

  calls.length = 0;
  await repository.findAllUserOrders({ status: 'PAID' }, { limit: 2, cursor: nextCursor });
  assert.match(calls[0].sql, /\(o\.created_at, o\.id\) < \(\$\d+::timestamptz, \$\d+::uuid\)/);
  assert.ok(calls[0].values.includes('2026-11-06T10:00:02.123456Z'));
  assert.ok(calls[0].values.includes('00000000-0000-4000-8000-000000000002'));

  await assert.rejects(
    () => repository.findAllUserOrders({ status: 'REFUNDED' }, { limit: 2, cursor: nextCursor }),
    { code: 'INVALID_CURSOR', statusCode: 400 }
  );
  await assert.rejects(
    () => repository.findOrdersByUserId(USER_ID, { status: 'PAID' }, { cursor: nextCursor }),
    { code: 'INVALID_CURSOR' }
  );
});

test('rejects malformed cursors and bad limits before querying', async (t) => {
  const calls = mockQueries(t);
  const fp = cursorUtil.filterFingerprint({});
  const forged = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');
  for (const cursor of [
    'not-base64-json', forged({ t: 'yesterday', i: ORDER_ID, f: fp }), forged({ t: '2026-11-06T10:00:00.123456Z', i: 'x', f: fp }),
    forged({ t: '2026-11-06T10:00:00.123456Z', i: ORDER_ID, f: 'other' }), 'a'.repeat(600), forged(null)
  ]) {
    await assert.rejects(() => repository.findAllUserOrders({}, { cursor }), { code: 'INVALID_CURSOR' });
  }
  for (const limit of [0, 51, 1.5, '5']) {
    await assert.rejects(() => repository.findAllUserOrders({}, { limit }), { statusCode: 400 });
  }
  assert.equal(calls.length, 0);
});

test('defaults the page size to 10 and allows up to 50', async (t) => {
  const calls = mockQueries(t);
  await repository.findAllUserOrders({}, {});
  assert.equal(calls[0].values[calls[0].values.length - 1], 11);
  await repository.findAllUserOrders({}, { limit: 50 });
  assert.equal(calls[1].values[calls[1].values.length - 1], 51);
});

test('per-user listing filters by the user id in addition to the guest exclusion', async (t) => {
  const calls = mockQueries(t);
  const page = await repository.findOrdersByUserId(USER_ID, { status: 'PAID', paymentStatus: 'CAPTURED', search: 'ignored' }, {});
  assert.deepEqual(page, { items: [], pagination: { nextCursor: null, hasMore: false } });
  const { sql, values } = calls[0];
  assert.match(sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
  assert.match(sql, /o\.user_id = \$\d+::uuid/);
  assert.ok(values.includes(USER_ID));
  assert.ok(values.includes('CAPTURED'));
  assert.equal(values.includes('ignored'), false, 'search is not a per-user filter');
});

test('single-order and child lookups all re-apply the guest exclusion', async (t) => {
  const calls = mockQueries(t);
  assert.equal(await repository.findOrderById(ORDER_ID), null);
  assert.deepEqual(await repository.findOrderItems(ORDER_ID), []);
  assert.deepEqual(await repository.findOrderPayments(ORDER_ID), []);
  assert.deepEqual([...(await repository.findPaymentTransactions([USER_ID]))], []);
  assert.equal(calls.length, 4);
  for (const { sql } of calls) {
    assert.match(sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
    assert.equal(/guest_/i.test(sql), false, 'guest columns are never selected');
  }
  assert.equal(/gateway_response|google_id/.test(calls.map((c) => c.sql).join('')), false);
  assertReadOnly(calls);
});

test('order details use separate queries and group transactions per payment attempt', async (t) => {
  const calls = mockQueries(t, (sql) => {
    if (sql.includes('FROM payment_transactions')) {
      return [
        { id: 't2', payment_id: 'p2', type: 'CAPTURE', status: 'SUCCESS', amount: '550.00', currency: 'INR', razorpay_payment_id: 'pay_2', webhook_event_id: 'w1', created_at: new Date('2026-11-06T10:01:00Z') },
        { id: 't1', payment_id: 'p2', type: 'ATTEMPT', status: 'SUCCESS', amount: '550.00', currency: 'INR', created_at: new Date('2026-11-06T10:00:00Z') },
        { id: 't3', payment_id: 'p1', type: 'FAILURE', status: 'FAILED', amount: '550.00', currency: 'INR', error_code: 'BAD', created_at: new Date('2026-11-06T09:00:00Z') }
      ];
    }
    if (sql.includes('FROM payments pay')) {
      return [
        { id: 'p2', attempt_number: 2, status: 'CAPTURED', method: 'upi', amount: '550.00', amount_refunded: '0', currency: 'INR', upi_handle_masked: 'ab***@okhdfc', created_at: new Date() },
        { id: 'p1', attempt_number: 1, status: 'FAILED', method: 'card', amount: '550.00', amount_refunded: '0', currency: 'INR', card_network: 'VISA', card_last4: '4242', card_type: 'CREDIT', created_at: new Date() }
      ];
    }
    if (sql.includes('FROM order_items')) {
      return [{ product_id: USER_ID, product_name: 'Chakli', product_slug: 'chakli', unit_price: '250.00', quantity: 2, total_price: '500.00' }];
    }
    return [{
      ...listRow(1), shipping_first_name: 'Vik', shipping_last_name: 'Rao', shipping_phone: '+91', shipping_country: 'IN ',
      shipping_address_line1: '1 Main St', shipping_address_line2: null, shipping_city: 'Pune', shipping_state: 'MH',
      shipping_postal_code: '411001', confirmed_at: new Date(), cancelled_at: null, updated_at: new Date()
    }];
  });

  const order = await repository.findOrderWithDetails(ORDER_ID);
  assert.equal(calls.length, 4, 'order, items, payments, transactions: no per-payment queries');
  assert.equal(order.shippingAddress.country, 'IN');
  assert.equal(order.items[0].totalPrice, 500);
  assert.equal(order.payments.length, 2);
  assert.deepEqual(order.payments[0].transactions.map((x) => x.type), ['CAPTURE', 'ATTEMPT']);
  assert.equal(order.payments[0].transactions[0].webhookEventId, 'w1');
  assert.match(calls.find((c) => c.sql.includes('FROM payment_transactions')).sql, /ORDER BY pt\.created_at DESC, pt\.id DESC/);
  assert.deepEqual(order.payments[1].transactions.map((x) => x.type), ['FAILURE']);
  assert.equal(order.payments[0].upiHandleMasked, 'ab***@okhdfc');
  assert.equal(order.payments[1].card.last4, '4242');
  assert.equal(order.payments[1].card.type, 'credit');
  assertReadOnly(calls);
});

test('findOrderWithDetails returns null (and stops) for missing or guest orders', async (t) => {
  const calls = mockQueries(t);
  assert.equal(await repository.findOrderWithDetails(ORDER_ID), null);
  assert.equal(calls.length, 1);
});

test('findPaymentTransactions skips the query when there are no payment ids', async (t) => {
  const calls = mockQueries(t);
  assert.equal((await repository.findPaymentTransactions([])).size, 0);
  assert.equal(calls.length, 0);
});

test('findUserById selects no credentials and maps the profile', async (t) => {
  const calls = mockQueries(t, () => [{ id: USER_ID, email: 'u@example.com', first_name: 'Vik', last_name: null, status: 'ACTIVE' }]);
  assert.deepEqual(await repository.findUserById(USER_ID), { id: USER_ID, email: 'u@example.com', firstName: 'Vik', lastName: null, status: 'ACTIVE' });
  assert.equal(/google_id/.test(calls[0].sql), false);
});

test('list mapping with no payment attempts yields a null latest payment', () => {
  const item = toOrderListItem(listRow(1, { payment_status: null, payment_method: null }));
  assert.equal(item.latestPayment, null);
  assert.equal(item.paymentStatus, null);
  assert.equal(item.paymentMethodSummary, null);
});
