const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { after, before, beforeEach, test } = require('node:test');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const orderId = '0b0a6c34-0f4e-4b9b-9d39-5d3c1f0a1111';
const userId = 'b094b9e4-de81-4fff-864c-d52ce853ff11';

let cms;
let baseUrl;
let prisma;
let generateAccessToken;
let originalQueryRaw;
let queryCalls; // { sql, values } for every statement the repository ran
let dbRows; // rows to return, or (sql, values) => rows
let dbError;

before(async () => {
  prisma = require('../src/config/database');
  originalQueryRaw = Object.getOwnPropertyDescriptor(prisma, '$queryRaw');
  Object.defineProperty(prisma, '$queryRaw', {
    configurable: true,
    writable: true,
    value: async (fragment) => {
      queryCalls.push({ sql: fragment.text, values: fragment.values });
      if (dbError) throw dbError;
      return typeof dbRows === 'function' ? dbRows(fragment.text, fragment.values) : dbRows;
    }
  });

  const app = require('../src/app');
  ({ generateAccessToken } = require('../src/services/jwt.service'));
  await new Promise((resolve) => { cms = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${cms.address().port}`;
});

after(async () => {
  if (originalQueryRaw) Object.defineProperty(prisma, '$queryRaw', originalQueryRaw);
  else delete prisma.$queryRaw;
  await new Promise((resolve) => cms.close(resolve));
});

beforeEach(() => {
  queryCalls = [];
  dbRows = [];
  dbError = undefined;
});

const token = (scope) => generateAccessToken({ clientId: 'cms-admin', scope });
const get = (path, scope) => fetch(`${baseUrl}${path}`, {
  headers: scope ? { Authorization: `Bearer ${token(scope)}` } : undefined
});

const dbOrderRow = (n, overrides = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  order_number: `VH261106-1000${n}`,
  status: 'PAID',
  currency: 'INR',
  subtotal: '500.00', discount_amount: '0.00', tax_amount: '0.00', shipping_amount: '50.00', total_amount: '550.00',
  user_id: userId, customer_email: 'asha@example.com', customer_phone: '+919999999999',
  created_at: new Date('2026-11-06T10:00:00Z'), paid_at: new Date('2026-11-06T10:05:00Z'),
  user_first_name: 'Asha', user_last_name: 'Rao',
  cursor_created_at: `2026-11-06T10:00:0${n}.123456Z`,
  payment_status: 'CAPTURED', payment_method: 'card', card_network: 'VISA', card_last4: '4242',
  bank_code: null, wallet_name: null, upi_handle_masked: null,
  ...overrides
});

const detailRows = (sql, values) => {
  if (/FROM users\b/.test(sql)) {
    return values[0] === userId
      ? [{ id: userId, email: 'account@example.com', first_name: 'Asha', last_name: 'Rao', status: 'ACTIVE' }]
      : [];
  }
  if (sql.includes('FROM payment_transactions')) {
    return [
      { id: 't2', payment_id: 'p1', type: 'CAPTURE', status: 'SUCCESS', amount: '550.00', currency: 'INR', razorpay_payment_id: 'pay_1', source: 'WEBHOOK', webhook_event_id: 'w1', created_at: new Date('2026-11-06T10:05:00Z'), gateway_response: { secret: 'x' }, idempotency_key: 'capture:pay_1' },
      { id: 't1', payment_id: 'p1', type: 'ATTEMPT', status: 'SUCCESS', amount: '550.00', currency: 'INR', source: 'API', created_at: new Date('2026-11-06T10:01:00Z') }
    ];
  }
  if (sql.includes('FROM payments pay')) {
    return [{
      id: 'p1', attempt_number: 1, gateway: 'RAZORPAY', razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1',
      status: 'CAPTURED', method: 'card', amount: '550.00', amount_refunded: '0.00', currency: 'INR',
      card_network: 'VISA', card_last4: '4242', card_type: 'CREDIT', card_issuer: 'HDFC',
      bank_code: 'HDFC', wallet_name: 'paytm', upi_handle_masked: 'ab***@okhdfc', // not the method's own: must be hidden
      card_number: '4111111111111111', cvv: '123', raw: 'secret',
      created_at: new Date('2026-11-06T10:01:00Z'), updated_at: new Date('2026-11-06T10:05:00Z'), captured_at: new Date('2026-11-06T10:05:00Z')
    }];
  }
  if (sql.includes('FROM order_items')) {
    return [{ id: 'i1', created_at: new Date('2026-11-06T10:00:00Z'), product_id: userId, product_name: 'Chakli', product_slug: 'chakli', unit_price: '250.00', quantity: 2, total_price: '500.00' }];
  }
  return [{
    ...dbOrderRow(1), shipping_first_name: 'Asha', shipping_last_name: 'Rao', shipping_phone: '+919999999999', shipping_country: 'IN ',
    shipping_address_line1: '1 Main St', shipping_address_line2: null, shipping_city: 'Pune', shipping_state: 'MH', shipping_postal_code: '411001',
    confirmed_at: new Date('2026-11-06T10:05:00Z'), cancelled_at: null, payment_expires_at: new Date('2026-11-07T10:00:00Z'),
    updated_at: new Date('2026-11-06T10:05:00Z'), user_email: 'account@example.com', guest_access_token_hash: 'secret-hash'
  }];
};

test('requires authentication and the matching scope on the order APIs', async () => {
  const routes = [
    { path: '/api/v1/orders', scope: 'orders:read' },
    { path: `/api/v1/orders/${orderId}`, scope: 'orders:read' },
    { path: `/api/v1/users/${userId}/orders`, scope: 'orders:user:read' }
  ];
  for (const route of routes) {
    assert.equal((await get(route.path)).status, 401, `${route.path} without a token`);
    const bad = await fetch(`${baseUrl}${route.path}`, { headers: { Authorization: 'Bearer not-a-jwt' } });
    assert.equal(bad.status, 401, `${route.path} with an invalid token`);
    assert.equal((await get(route.path, 'products:write')).status, 403, `${route.path} without the scope`);
    // orders:read must not unlock the per-user route and vice versa
    const other = route.scope === 'orders:read' ? 'orders:user:read' : 'orders:read';
    assert.equal((await get(route.path, other)).status, 403, `${route.path} with the other orders scope`);
    dbRows = detailRows;
    assert.equal((await get(route.path, route.scope)).status, 200, `${route.path} with the scope`);
  }
});

test('lists registered-user orders from the repository with filters and a cursor', async () => {
  dbRows = [dbOrderRow(3), dbOrderRow(2, { payment_status: null, payment_method: null }), dbOrderRow(1)];
  const response = await get('/api/v1/orders?limit=2&status=PAID&paymentStatus=CAPTURED&search=asha&fromDate=2026-11-01&toDate=2026-11-06', 'orders:read');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, 'Orders retrieved successfully');
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.pagination.hasMore, true);
  assert.match(body.data.pagination.nextCursor, /^[A-Za-z0-9_-]+$/);

  assert.deepEqual(body.data.items[0], {
    id: '00000000-0000-4000-8000-000000000003',
    orderNumber: 'VH261106-10003',
    userId,
    customer: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+919999999999' },
    status: 'PAID',
    currency: 'INR',
    subtotal: 500,
    discountAmount: 0,
    taxAmount: 0,
    shippingAmount: 50,
    totalAmount: 550,
    paymentStatus: 'CAPTURED',
    paymentMethod: 'card',
    paymentMethodSummary: 'Visa •••• 4242',
    createdAt: '2026-11-06T10:00:00.000Z',
    paidAt: '2026-11-06T10:05:00.000Z'
  });
  // no payment attempt -> null payment information
  assert.equal(body.data.items[1].paymentStatus, null);
  assert.equal(body.data.items[1].paymentMethod, null);
  assert.equal(body.data.items[1].paymentMethodSummary, null);

  const [{ sql, values }] = queryCalls;
  assert.match(sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
  assert.match(sql, /ORDER BY o\.created_at DESC, o\.id DESC/);
  assert.equal(/OFFSET/i.test(sql), false);
  for (const expected of ['PAID', 'CAPTURED', '2026-11-01T00:00:00.000Z', '2026-11-07T00:00:00.000Z']) {
    assert.ok(values.includes(expected), `${expected} is bound as a parameter`);
  }
  assert.equal(values[values.length - 1], 3);

  // the returned cursor is accepted with the same filters
  queryCalls.length = 0;
  const next = await get(`/api/v1/orders?limit=2&status=PAID&paymentStatus=CAPTURED&search=asha&fromDate=2026-11-01&toDate=2026-11-06&cursor=${body.data.pagination.nextCursor}`, 'orders:read');
  assert.equal(next.status, 200);
  assert.match(queryCalls[0].sql, /\(o\.created_at, o\.id\) < \(/);
  // ...but not with different filters
  const other = await get(`/api/v1/orders?limit=2&status=REFUNDED&cursor=${body.data.pagination.nextCursor}`, 'orders:read');
  assert.equal(other.status, 400);
  assert.equal((await other.json()).error.code, 'INVALID_REQUEST');
});

test('returns an empty page when there are no registered-user orders', async () => {
  const response = await get('/api/v1/orders', 'orders:read');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { items: [], pagination: { nextCursor: null, hasMore: false } });
  assert.equal(queryCalls[0].values[queryCalls[0].values.length - 1], 11, 'default limit 10 (+1)');
});

test('rejects invalid list parameters without touching the database', async () => {
  const cases = [
    'limit=0', 'limit=51', 'limit=abc', 'limit=1&limit=2', 'status=NOPE', 'paymentStatus=NOPE',
    'cursor=bad%20cursor', 'cursor=abc', 'fromDate=yesterday', 'toDate=2026-02-30',
    'fromDate=2026-11-05&toDate=2026-11-01', `search=${'a'.repeat(101)}`, 'search=%00'
  ];
  for (const query of cases) {
    queryCalls.length = 0;
    const response = await get(`/api/v1/orders?${query}`, 'orders:read');
    assert.equal(response.status, 400, query);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_REQUEST', query);
    assert.equal(queryCalls.length, 0, `${query} must not reach the database`);
  }
});

test('reports unexpected database failures as INTERNAL_ERROR without details', async () => {
  dbError = new Error('connection to db.internal:5432 refused, password=hunter2');
  const response = await get('/api/v1/orders', 'orders:read');
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
});

test('uses the standard error envelope for authentication and scope failures', async () => {
  const missing = await get('/api/v1/orders');
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  const forbidden = await get('/api/v1/orders', 'orders:user:read');
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, 'FORBIDDEN');
});

test('returns the full registered-user order from the repository in separate sections', async () => {
  dbRows = detailRows;
  const response = await get(`/api/v1/orders/${orderId}`, 'orders:read');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, 'Order retrieved successfully');
  assert.deepEqual(Object.keys(body.data), ['order', 'customer', 'shippingAddress', 'items', 'payments']);

  const { order, customer, shippingAddress, items, payments } = body.data;
  assert.deepEqual(order, {
    id: '00000000-0000-4000-8000-000000000001', orderNumber: 'VH261106-10001', userId, customerType: 'REGISTERED',
    status: 'PAID', currency: 'INR', subtotal: 500, discountAmount: 0, taxAmount: 0, shippingAmount: 50, totalAmount: 550,
    confirmedAt: '2026-11-06T10:05:00.000Z', paidAt: '2026-11-06T10:05:00.000Z', cancelledAt: null,
    paymentExpiresAt: '2026-11-07T10:00:00.000Z', createdAt: '2026-11-06T10:00:00.000Z', updatedAt: '2026-11-06T10:05:00.000Z'
  });
  assert.deepEqual(customer, { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+919999999999' });
  assert.equal(shippingAddress.city, 'Pune');
  assert.equal(shippingAddress.country, 'IN');
  assert.deepEqual(items, [{
    id: 'i1', productId: userId, productName: 'Chakli', productSlug: 'chakli', unitPrice: 250, quantity: 2,
    totalPrice: 500, createdAt: '2026-11-06T10:00:00.000Z'
  }]);

  assert.equal(payments.length, 1);
  assert.equal(payments[0].gateway, 'RAZORPAY');
  assert.equal(payments[0].razorpayOrderId, 'order_1');
  assert.equal(payments[0].status, 'CAPTURED');
  assert.equal(payments[0].method, 'card');
  assert.deepEqual(payments[0].methodDetails, {
    card: { network: 'Visa', last4: '4242', type: 'credit', issuer: 'HDFC' }, bankCode: null, walletName: null, upiHandleMasked: null
  });
  assert.deepEqual(payments[0].transactions.map((t) => t.id), ['t2', 't1'], 'newest first');
  assert.equal(payments[0].transactions[0].webhookEventId, 'w1');
  assert.equal(payments[0].transactions[0].paymentId, 'p1');

  const serialized = JSON.stringify(body);
  for (const leaked of ['4111111111111111', '"cvv"', 'gatewayResponse', 'gateway_response', 'secret-hash', 'idempotency', 'capture:pay_1', 'account@example.com']) {
    assert.equal(serialized.includes(leaked), false, `${leaked} must not be returned`);
  }

  for (const { sql } of queryCalls) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.match(sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
  }
  assert.equal(queryCalls.length, 4);
});

test('falls back to the account email when the order has no email snapshot', async () => {
  dbRows = (sql, values) => detailRows(sql, values).map((row) => (row.order_number ? { ...row, customer_email: null } : row));
  const { data } = await (await get(`/api/v1/orders/${orderId}`, 'orders:read')).json();
  assert.equal(data.customer.email, 'account@example.com');
});

test('returns the same 404 for unknown and guest orders, and 400 for a bad id', async () => {
  const invalid = await get('/api/v1/orders/not-a-uuid', 'orders:read');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_ORDER_ID');
  assert.equal(queryCalls.length, 0);

  // The repository returns no row for a missing order and for a guest order alike.
  const missing = await get(`/api/v1/orders/${orderId}`, 'orders:read');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  assert.equal(queryCalls.length, 1, 'stops after the order lookup');
});

test('reports database failures on order detail as INTERNAL_ERROR', async () => {
  dbError = new Error('boom');
  const response = await get(`/api/v1/orders/${orderId}`, 'orders:read');
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
});

test('lists a registered user\'s orders with the same summary shape as the full list', async () => {
  dbRows = (sql, values) => (/FROM users\b/.test(sql)
    ? detailRows(sql, values)
    : [dbOrderRow(3), dbOrderRow(2), dbOrderRow(1)]);
  const response = await get(`/api/v1/users/${userId}/orders?limit=2&status=PAID&paymentStatus=CAPTURED&search=ignored&fromDate=2026-01-01`, 'orders:user:read');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, 'User orders retrieved successfully');
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0].userId, userId);
  assert.equal(body.data.items[0].paymentMethodSummary, 'Visa •••• 4242');
  assert.deepEqual(Object.keys(body.data.items[0]), [
    'id', 'orderNumber', 'userId', 'customer', 'status', 'currency', 'subtotal', 'discountAmount', 'taxAmount',
    'shippingAmount', 'totalAmount', 'paymentStatus', 'paymentMethod', 'paymentMethodSummary', 'createdAt', 'paidAt'
  ]);
  assert.equal(body.data.pagination.hasMore, true);

  const orderQuery = queryCalls.find((c) => /FROM orders o/.test(c.sql));
  assert.match(orderQuery.sql, /o\.customer_type = 'USER' AND o\.user_id IS NOT NULL/);
  assert.match(orderQuery.sql, /o\.user_id = \$\d+::uuid/);
  assert.match(orderQuery.sql, /ORDER BY o\.created_at DESC, o\.id DESC/);
  assert.equal(/OFFSET/i.test(orderQuery.sql), false);
  assert.ok(orderQuery.values.includes(userId));
  assert.ok(orderQuery.values.includes('PAID') && orderQuery.values.includes('CAPTURED'));
  assert.equal(orderQuery.values.includes('ignored'), false, 'search is not a per-user filter');
  assert.equal(orderQuery.values.includes('2026-01-01T00:00:00.000Z'), false, 'dates are not a per-user filter');

  // the cursor continues the same query...
  queryCalls.length = 0;
  const next = await get(`/api/v1/users/${userId}/orders?limit=2&status=PAID&paymentStatus=CAPTURED&cursor=${body.data.pagination.nextCursor}`, 'orders:user:read');
  assert.equal(next.status, 200);
  assert.match(queryCalls.find((c) => /FROM orders o/.test(c.sql)).sql, /\(o\.created_at, o\.id\) < \(/);
  // ...but is rejected under different filters
  const other = await get(`/api/v1/users/${userId}/orders?limit=2&status=REFUNDED&cursor=${body.data.pagination.nextCursor}`, 'orders:user:read');
  assert.equal(other.status, 400);
  assert.equal((await other.json()).error.code, 'INVALID_REQUEST');
});

test('returns "No orders found" for an existing user without orders', async () => {
  dbRows = (sql, values) => (/FROM users\b/.test(sql) ? detailRows(sql, values) : []);
  const response = await get(`/api/v1/users/${userId}/orders`, 'orders:user:read');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { items: [], pagination: { nextCursor: null, hasMore: false } },
    message: 'No orders found'
  });
});

test('returns 404 USER_NOT_FOUND for an unknown user and 400 for invalid input', async () => {
  dbRows = detailRows;
  const unknown = await get('/api/v1/users/11111111-1111-4111-8111-111111111111/orders', 'orders:user:read');
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
  assert.equal(queryCalls.length, 1, 'no order query for an unknown user');

  queryCalls.length = 0;
  const invalidId = await get('/api/v1/users/nope/orders', 'orders:user:read');
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error.code, 'INVALID_USER_ID');

  for (const query of ['limit=0', 'limit=51', 'limit=abc', 'status=NOPE', 'paymentStatus=NOPE', 'cursor=bad%20cursor']) {
    const response = await get(`/api/v1/users/${userId}/orders?${query}`, 'orders:user:read');
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST', query);
  }
  const badCursor = await get(`/api/v1/users/${userId}/orders?cursor=abc`, 'orders:user:read');
  assert.equal(badCursor.status, 400);
  assert.deepEqual((await badCursor.json()).error.details, [{ field: 'cursor', message: 'cursor is invalid' }]);
  assert.equal(queryCalls.length, 1, 'only the final bad-cursor request reached the user lookup');
});

test('reports database failures on the per-user list as INTERNAL_ERROR', async () => {
  dbError = new Error('boom');
  const response = await get(`/api/v1/users/${userId}/orders`, 'orders:user:read');
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
});

test('does not interfere with the existing user account routes', async () => {
  // /users/:userId still belongs to the user module: it is protected by users:read, not orders scopes
  assert.equal((await get(`/api/v1/users/${userId}`)).status, 401);
  assert.equal((await get(`/api/v1/users/${userId}`, 'orders:user:read')).status, 403);
});

test('documents the three order endpoints completely in the OpenAPI spec', () => {
  const spec = require('../src/config/swagger');
  const scopes = spec.components.securitySchemes.OAuth2.flows.clientCredentials.scopes;
  assert.ok(scopes['orders:read'] && scopes['orders:user:read']);
  assert.equal(Object.keys(spec.paths).some((path) => path.includes('/admin')), false, 'no /admin paths');

  const contract = {
    '/api/v1/orders': { scope: 'orders:read', params: ['limit', 'cursor', 'status', 'paymentStatus', 'search', 'fromDate', 'toDate'], codes: ['200', '400', '401', '403', '500'] },
    '/api/v1/orders/{orderId}': { scope: 'orders:read', params: ['orderId'], codes: ['200', '400', '401', '403', '404', '500'] },
    '/api/v1/users/{userId}/orders': { scope: 'orders:user:read', params: ['userId', 'limit', 'cursor', 'status', 'paymentStatus'], codes: ['200', '400', '401', '403', '404', '500'] }
  };
  for (const [path, expected] of Object.entries(contract)) {
    const operation = spec.paths[path].get;
    assert.ok(operation, `${path} is documented`);
    assert.deepEqual(operation.security, [{ OAuth2: [expected.scope] }], `${path} security`);
    assert.deepEqual(operation.parameters.map((p) => p.name).sort(), [...expected.params].sort(), `${path} parameters`);
    for (const code of expected.codes) assert.ok(operation.responses[code], `${path} documents ${code}`);
    assert.deepEqual(operation.tags, ['Orders']);
  }
  const pathParams = [...spec.paths['/api/v1/orders/{orderId}'].get.parameters, ...spec.paths['/api/v1/users/{userId}/orders'].get.parameters].filter((p) => p.in === 'path');
  assert.ok(pathParams.every((p) => p.required === true && p.schema.format === 'uuid'));
  assert.deepEqual(spec.paths['/api/v1/orders'].get.parameters.find((p) => p.name === 'limit').schema, { type: 'integer', minimum: 1, maximum: 50, default: 10 });

  // response schemas: pagination, customer, payment attempts, payment transactions
  const schemas = spec.components.schemas;
  const detail = schemas.RegisteredOrderDetail.properties;
  assert.deepEqual(Object.keys(detail), ['order', 'customer', 'shippingAddress', 'items', 'payments']);
  assert.ok(detail.customer.properties.email && detail.customer.properties.phone);
  assert.equal(detail.payments.items.$ref, '#/components/schemas/RegisteredOrderPayment');
  assert.ok(schemas.RegisteredOrderPayment.properties.transactions);
  assert.ok(schemas.RegisteredOrderPayment.properties.methodDetails);
  assert.ok(schemas.RegisteredOrderTransaction.properties.razorpayRefundId);
  assert.equal(schemas.RegisteredOrderTransaction.properties.gatewayResponse, undefined, 'raw gateway response is not part of the contract');
  const listData = spec.paths['/api/v1/orders'].get.responses['200'].content['application/json'].schema.properties.data.properties;
  assert.ok(listData.items && listData.pagination.properties.nextCursor && listData.pagination.properties.hasMore);
  assert.ok(schemas.RegisteredOrderSummary.properties.customer.properties.firstName);
  assert.ok(spec.paths['/api/v1/users/{userId}/orders'].get.responses['200'].content['application/json'].examples.noOrders);

  // every $ref resolves
  const refs = new Set(JSON.stringify(spec).match(/#\/components\/[A-Za-z]+\/[A-Za-z]+/g));
  for (const ref of refs) {
    const [, , type, name] = ref.split('/');
    assert.ok(spec.components[type][name], `${ref} resolves`);
  }
});

test('order code contains no raw/unsafe SQL execution and no /admin routes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src', 'orders');
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.equal(/\$queryRawUnsafe|\$executeRaw|\$executeRawUnsafe/.test(source), false, `${file} uses only parameterised $queryRaw`);
    assert.equal(/\/admin/.test(source), false, `${file} has no /admin path`);
    assert.equal(/authenticateUser|googleId|google_id/.test(source.replace(/^\s*\/\/.*$/gm, '')), false, `${file} uses no other auth mechanism`);
  }
});
