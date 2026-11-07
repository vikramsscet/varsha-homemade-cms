// Integration tests for the order APIs against a REAL PostgreSQL database that has the main
// service's migrations 001-011 applied. They are skipped unless explicitly enabled:
//
//   RUN_DB_TESTS=1
//   TEST_SEED_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/varsha_orders_test   (seeds data; superuser)
//   DATABASE_URL=postgresql://cms_ro@127.0.0.1:55432/varsha_orders_test               (what the CMS uses)
//
// Safety: the database name must end in "_test" (the seed step TRUNCATEs the order tables). The
// CMS connection is a role granted SELECT on only the five order tables - so a write, or any read of
// guest_checkout_sessions / payment_webhook_events, fails with "permission denied".
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');

const seedUrl = process.env.TEST_SEED_DATABASE_URL;
const appUrl = process.env.DATABASE_URL || '';
const dbName = (url) => (url.match(/\/([^/?]+)(\?|$)/) || [])[1] || '';
const enabled = process.env.RUN_DB_TESTS === '1' && seedUrl && dbName(seedUrl).endsWith('_test') && dbName(appUrl) === dbName(seedUrl);
const opts = { skip: enabled ? false : 'set RUN_DB_TESTS=1, TEST_SEED_DATABASE_URL and DATABASE_URL to a *_test database' };

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.JWT_ISSUER = 'cms-service-test';
process.env.JWT_AUDIENCE = 'cms-api-test';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_PRIVATE_KEY = privatePem;

const U_A = 'a0000000-0000-4000-8000-00000000000a';
const U_B = 'b0000000-0000-4000-8000-00000000000b';
const U_C = 'c0000000-0000-4000-8000-00000000000c';
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const O = (n) => id('0', n); // orders
const P = (n) => id('1', n); // payments

const TABLES = ['users', 'orders', 'order_items', 'payments', 'payment_transactions'];
let seed;
let prisma;
let cms;
let baseUrl;
let generateAccessToken;
let statements;
let originalQueryRaw;

const token = (scope) => generateAccessToken({ clientId: 'cms-admin', scope });
const api = (path, scope) => fetch(`${baseUrl}${path}`, { headers: scope ? { Authorization: `Bearer ${token(scope)}` } : {} });
const json = async (path, scope = 'orders:read') => {
  const response = await api(path, scope);
  return { status: response.status, body: await response.json() };
};
const run = (sql, ...params) => seed.$executeRawUnsafe(sql, ...params);

const checksums = async () => {
  const out = {};
  for (const table of TABLES) {
    const [row] = await seed.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h, count(*)::int AS n FROM ${table} t`);
    out[table] = `${row.n}:${row.h}`;
  }
  return out;
};

const order = (n, o) => run(
  `INSERT INTO orders (id, order_number, customer_type, user_id, guest_access_token_hash, status, subtotal, shipping_amount, total_amount,
     customer_email, customer_phone, shipping_first_name, shipping_last_name, shipping_phone, shipping_country, shipping_address_line1,
     shipping_city, shipping_state, shipping_postal_code, confirmed_at, paid_at, cancelled_at, payment_expires_at, created_at)
   VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, 500, 50, 550, $7, $8, $9, $10, '+919800000000', 'IN', '1 Main St', 'Pune', 'MH', '411001',
     $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15::timestamptz)`,
  O(n), o.number, o.user ? 'USER' : 'GUEST', o.user || null, o.user ? null : String(n).padStart(64, 'f'), o.status, o.email, o.phone,
  o.first || 'Ship', o.last || 'Target',
  o.paidAt ? o.created : null, o.paidAt ? o.created : null, o.status === 'CANCELLED' ? o.created : null, o.created, o.created
);
const item = (orderNo, n, productName, unit, qty) => run(
  `INSERT INTO order_items (id, order_id, product_id, product_name, product_slug, unit_price, quantity, total_price)
   VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)`,
  id('2', orderNo * 10 + n), O(orderNo), id('3', n), productName, productName.toLowerCase(), unit, qty, unit * qty
);
const pay = (n, orderNo, attempt, p) => run(
  `INSERT INTO payments (id, order_id, attempt_number, razorpay_order_id, razorpay_payment_id, status, amount, amount_refunded, method,
     card_network, card_last4, card_type, card_issuer, bank_code, wallet_name, upi_handle_masked, failure_code, failure_reason,
     authorized_at, captured_at, failed_at, created_at)
   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 550, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
     $18::timestamptz, $19::timestamptz, $20::timestamptz, $21::timestamptz)`,
  P(n), O(orderNo), attempt, `order_t${n}`, p.rzp || null, p.status, p.refunded || 0, p.method || null, p.network || null, p.last4 || null,
  p.cardType || null, p.issuer || null, p.bank || null, p.wallet || null, p.upi || null, p.failCode || null, p.failReason || null,
  p.authorizedAt || null, p.capturedAt || null, p.failedAt || null, p.created
);
const txn = (key, payN, type, status, at, extra = {}) => run(
  `INSERT INTO payment_transactions (payment_id, type, status, amount, razorpay_payment_id, razorpay_refund_id, idempotency_key, source,
     webhook_event_id, error_code, error_description, gateway_response, created_at)
   VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb, $13::timestamptz)`,
  P(payN), type, status, extra.amount || 550, extra.rzp || null, extra.refund || null, key, extra.source || 'API', extra.webhook || null,
  extra.errCode || null, extra.errDesc || null,
  JSON.stringify({ api_secret: 'LEAK-ME-SECRET', card_number: '4111111111111111', cvv: '737' }), at
);

before(async () => {
  if (!enabled) return;
  const { PrismaClient } = require('@prisma/client');
  seed = new PrismaClient({ datasources: { db: { url: seedUrl } } });

  await run('TRUNCATE users, orders, order_items, payments, payment_transactions, payment_webhook_events, guest_checkout_sessions, carts, user_addresses CASCADE');
  await run(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cms_ro') THEN CREATE ROLE cms_ro LOGIN; END IF; END $$`);
  await run('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cms_ro');
  await run(`GRANT SELECT ON ${TABLES.join(', ')} TO cms_ro`);

  await run(`INSERT INTO users (id, email, first_name, last_name) VALUES
    ('${U_A}', 'account.a@example.com', 'Asha', 'Rao'), ('${U_B}', 'account.b@example.com', 'Bhanu', NULL), ('${U_C}', 'account.c@example.com', 'Chitra', 'Sen')`);

  const t = (day, hour = 10, minute = 0) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
  const A = { user: U_A, email: 'asha@example.com', phone: '+919811111111' };
  const B = { user: U_B, email: 'bhanu@example.com', phone: '+919822222222' };
  const G = { user: null, email: 'guest@example.com', phone: '+919833333333', first: 'Gita', last: 'Guest' };

  // user A: six orders; A4 and A5 share created_at (id tie-break)
  await order(1, { ...A, number: 'VHT-A1', status: 'PAID', created: t(1), paidAt: true });
  await order(2, { ...A, number: 'VHT-A2', status: 'PAID', created: t(2), paidAt: true });
  await order(3, { ...A, number: 'VHT-A3', status: 'PAYMENT_FAILED', created: t(3) });
  await order(4, { ...A, number: 'VHT-A4', status: 'PENDING_PAYMENT', created: t(4) });
  await order(5, { ...A, number: 'VHT-A5', status: 'PARTIALLY_REFUNDED', created: t(4), paidAt: true });
  await order(6, { ...A, number: 'VHT-A6', status: 'CANCELLED', created: t(5) });
  // user B
  await order(7, { ...B, number: 'VHT-B1', status: 'PAID', created: t(6), paidAt: true });
  await order(8, { ...B, number: 'VHT-B2', status: 'PENDING_PAYMENT', created: t(7) });
  // guests are the NEWEST orders, so any leak would show up first
  await order(9, { ...G, number: 'VHT-G1', status: 'PAID', created: t(8), paidAt: true });
  await order(10, { ...G, number: 'VHT-G2', status: 'PENDING_PAYMENT', created: t(9) });

  await item(1, 1, 'Chakli', 150, 2);
  await item(1, 2, 'Laddu', 200, 1);
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) await item(n, 1, 'Chakli', 250, 2);

  // A1: failed card attempt, then a captured UPI attempt (webhook-confirmed)
  await pay(1, 1, 1, { status: 'FAILED', method: 'card', network: 'VISA', last4: '1111', cardType: 'DEBIT', issuer: 'HDFC', failCode: 'BAD_REQUEST_ERROR', failReason: 'Card declined', failedAt: t(1, 11), created: t(1, 10) });
  await pay(2, 1, 2, { status: 'CAPTURED', method: 'upi', upi: 'as***@okhdfc', rzp: 'pay_t2', authorizedAt: t(1, 12), capturedAt: t(1, 12), created: t(1, 12) });
  await run(`INSERT INTO payment_webhook_events (id, gateway_event_id, event_type, payment_id, signature_verified, payload) VALUES ('${id('4', 1)}', 'evt_1', 'payment.captured', '${P(2)}', true, '{}')`);
  await txn('t-a1-1', 1, 'ATTEMPT', 'PENDING', t(1, 10));
  await txn('t-a1-2', 1, 'FAILURE', 'FAILED', t(1, 11), { errCode: 'BAD_REQUEST_ERROR', errDesc: 'Card declined' });
  await txn('t-a1-3', 2, 'ATTEMPT', 'PENDING', t(1, 12));
  await txn('t-a1-4', 2, 'AUTHORIZATION', 'SUCCESS', t(1, 12, 30), { rzp: 'pay_t2' });
  await txn('t-a1-5', 2, 'CAPTURE', 'SUCCESS', t(1, 13), { rzp: 'pay_t2', source: 'WEBHOOK', webhook: id('4', 1) });
  // A2: single captured card payment
  await pay(3, 2, 1, { status: 'CAPTURED', method: 'card', network: 'MASTERCARD', last4: '4444', cardType: 'CREDIT', issuer: 'ICICI', rzp: 'pay_t3', capturedAt: t(2, 11), created: t(2, 10) });
  // A3: failed netbanking
  await pay(4, 3, 1, { status: 'FAILED', method: 'netbanking', bank: 'HDFC', failCode: 'GATEWAY_ERROR', failReason: 'Bank unavailable', failedAt: t(3, 11), created: t(3, 10) });
  // A4: pending payment with NO method metadata yet
  await pay(5, 4, 1, { status: 'PENDING', created: t(4, 10) });
  // A5: captured then partially refunded
  await pay(6, 5, 1, { status: 'PARTIALLY_REFUNDED', refunded: 100, method: 'card', network: 'VISA', last4: '4242', cardType: 'CREDIT', issuer: 'HDFC', rzp: 'pay_t6', capturedAt: t(4, 11), created: t(4, 10) });
  await txn('t-a5-1', 6, 'ATTEMPT', 'PENDING', t(4, 10));
  await txn('t-a5-2', 6, 'CAPTURE', 'SUCCESS', t(4, 11), { rzp: 'pay_t6' });
  await txn('t-a5-3', 6, 'REFUND', 'SUCCESS', t(4, 12), { rzp: 'pay_t6', refund: 'rfnd_t6', amount: 100 });
  // B1 wallet; B2 authorized (in flight)
  await pay(7, 7, 1, { status: 'CAPTURED', method: 'wallet', wallet: 'paytm', rzp: 'pay_t7', capturedAt: t(6, 11), created: t(6, 10) });
  await pay(8, 8, 1, { status: 'AUTHORIZED', method: 'card', network: 'RUPAY', created: t(7, 10), authorizedAt: t(7, 11) });
  // guest payments (captured) - must never surface
  await pay(9, 9, 1, { status: 'CAPTURED', method: 'card', network: 'VISA', last4: '9999', rzp: 'pay_t9', capturedAt: t(8, 11), created: t(8, 10) });
  await txn('t-g1-1', 9, 'CAPTURE', 'SUCCESS', t(8, 11), { rzp: 'pay_t9' });

  prisma = require('../src/config/database');
  originalQueryRaw = Object.getOwnPropertyDescriptor(prisma, '$queryRaw');
  const raw = prisma.$queryRaw.bind(prisma);
  statements = [];
  Object.defineProperty(prisma, '$queryRaw', {
    configurable: true,
    writable: true,
    value: (fragment) => { statements.push(fragment.text); return raw(fragment); }
  });

  const app = require('../src/app');
  ({ generateAccessToken } = require('../src/services/jwt.service'));
  await new Promise((resolve) => { cms = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${cms.address().port}`;
});

after(async () => {
  if (!enabled) return;
  await new Promise((resolve) => cms.close(resolve));
  if (originalQueryRaw) Object.defineProperty(prisma, '$queryRaw', originalQueryRaw);
  await prisma.$disconnect();
  await seed.$disconnect();
});

// registered orders, newest first (created_at DESC, id DESC)
const REGISTERED_NEWEST_FIRST = () => [8, 7, 6, 5, 4, 3, 2, 1]
  .map((n) => ({ n, id: O(n) }))
  .sort((a, b) => {
    const day = (n) => ({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, 6: 5, 7: 6, 8: 7 }[n]);
    return day(b.n) - day(a.n) || (a.id < b.id ? 1 : -1);
  })
  .map((x) => x.id);
const GUEST_IDS = [O(9), O(10)];

test('the CMS database role can read the order tables but cannot write or read guest sessions', opts, async () => {
  assert.ok(Array.isArray(await prisma.$queryRawUnsafe('SELECT 1 FROM orders LIMIT 1')));
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE orders SET status = 'PAID'`), /permission denied/i);
  await assert.rejects(() => prisma.$executeRawUnsafe('DELETE FROM payment_transactions'), /permission denied/i);
  await assert.rejects(() => prisma.$queryRawUnsafe('SELECT 1 FROM guest_checkout_sessions LIMIT 1'), /permission denied/i);
});

test('OAuth: missing, invalid, expired and under-scoped tokens are rejected on every order API', opts, async () => {
  const claims = { client_id: 'cms-admin', scope: 'orders:read orders:user:read' };
  const sign = (extra) => jwt.sign(claims, privatePem, {
    algorithm: 'RS256', issuer: 'cms-service-test', audience: 'cms-api-test', subject: 'cms-admin', ...extra
  });
  const expired = sign({ expiresIn: -60 });
  const tampered = `${sign({ expiresIn: '5m' }).slice(0, -4)}AAAA`;
  const wrongAudience = sign({ expiresIn: '5m', audience: 'someone-else' });
  const routes = [
    ['/api/v1/orders', 'orders:read', 'orders:user:read'],
    [`/api/v1/orders/${O(1)}`, 'orders:read', 'orders:user:read'],
    [`/api/v1/users/${U_A}/orders`, 'orders:user:read', 'orders:read']
  ];
  for (const [path, scope, wrongScope] of routes) {
    for (const [label, header] of [['missing', undefined], ['invalid', 'Bearer garbage'], ['expired', `Bearer ${expired}`],
      ['tampered', `Bearer ${tampered}`], ['wrong audience', `Bearer ${wrongAudience}`], ['not bearer', 'Basic abc']]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: header ? { Authorization: header } : {} });
      assert.equal(response.status, 401, `${path} ${label}`);
      assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    }
    const forbidden = await api(path, wrongScope);
    assert.equal(forbidden.status, 403, `${path} with ${wrongScope}`);
    assert.equal((await forbidden.json()).error.code, 'FORBIDDEN');
    assert.equal((await api(path, 'products:write categories:write')).status, 403);
    assert.equal((await api(path, scope)).status, 200, `${path} with ${scope}`);
  }
});

test('GET /orders returns every registered-user order and no guest order, newest first', opts, async () => {
  const { status, body } = await json('/api/v1/orders');
  assert.equal(status, 200);
  assert.equal(body.message, 'Orders retrieved successfully');
  const ids = body.data.items.map((i) => i.id);
  assert.deepEqual(ids, REGISTERED_NEWEST_FIRST(), 'default limit 10 covers all 8, correctly ordered incl. the created_at tie');
  assert.equal(body.data.pagination.hasMore, false);
  for (const guest of GUEST_IDS) assert.equal(ids.includes(guest), false);
  const text = JSON.stringify(body);
  for (const leaked of ['guest@example.com', 'Gita', '+919833333333', 'VHT-G1', 'VHT-G2', '9999']) {
    assert.equal(text.includes(leaked), false, `${leaked} (guest data) must not appear`);
  }
  const a4 = body.data.items.find((i) => i.id === O(4));
  assert.equal(a4.paymentStatus, 'PENDING');
  assert.equal(a4.paymentMethod, null, 'pending payment without metadata');
  assert.equal(a4.paymentMethodSummary, null);
  const a6 = body.data.items.find((i) => i.id === O(6));
  assert.equal(a6.paymentStatus, null, 'no payment attempt -> null payment information');
  const a1 = body.data.items.find((i) => i.id === O(1));
  assert.equal(a1.paymentStatus, 'CAPTURED', 'latest attempt (attempt 2) is used, not the failed attempt 1');
  assert.equal(a1.paymentMethod, 'upi');
  assert.equal(a1.paymentMethodSummary, 'UPI');
  assert.deepEqual(a1.customer, { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+919811111111' });
  assert.equal(a1.userId, U_A);
  assert.equal(a1.totalAmount, 550);
  const b1 = body.data.items.find((i) => i.id === O(7));
  assert.equal(b1.customer.lastName, null, 'missing last name -> null');
  assert.equal(b1.paymentMethodSummary, 'Paytm');
});

test('pagination: pages cover the set exactly once, in order, with filters preserved', opts, async () => {
  const collect = async (query, limit) => {
    const ids = [];
    let cursor;
    let pages = 0;
    do {
      const { status, body } = await json(`/api/v1/orders?limit=${limit}${query}${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(status, 200);
      ids.push(...body.data.items.map((i) => i.id));
      cursor = body.data.pagination.nextCursor;
      assert.equal(body.data.pagination.hasMore, cursor !== null);
      pages += 1;
      assert.ok(pages < 20, 'terminates');
    } while (cursor);
    return { ids, pages };
  };

  const all = await collect('', 3);
  assert.equal(all.pages, 3);
  assert.deepEqual(all.ids, REGISTERED_NEWEST_FIRST());
  assert.equal(new Set(all.ids).size, all.ids.length, 'no duplicates');
  assert.deepEqual((await collect('', 1)).ids, REGISTERED_NEWEST_FIRST(), 'limit=1 walks the created_at tie correctly');

  const paid = await collect('&status=PAID', 1);
  assert.equal(paid.pages, 3);
  assert.deepEqual(paid.ids.sort(), [O(1), O(2), O(7)].sort());
  const captured = await collect('&paymentStatus=CAPTURED', 2);
  assert.deepEqual(captured.ids.sort(), [O(1), O(2), O(7)].sort(), 'paymentStatus filters on the LATEST attempt');
  const failedLatest = await collect('&paymentStatus=FAILED', 5);
  assert.deepEqual(failedLatest.ids, [O(3)], 'A1 has a failed attempt but its latest attempt is captured');

  // a cursor cannot be reused with other filters, and garbage is rejected
  const first = await json('/api/v1/orders?limit=1&status=PAID');
  const reused = await json(`/api/v1/orders?limit=1&status=PENDING_PAYMENT&cursor=${first.body.data.pagination.nextCursor}`);
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, 'INVALID_REQUEST');
  assert.equal((await json('/api/v1/orders?cursor=AAAA')).status, 400);
});

test('limits: default 10, maximum 50, invalid values rejected', opts, async () => {
  assert.equal((await json('/api/v1/orders?limit=50')).status, 200);
  for (const bad of ['0', '51', '-1', '1.5', 'abc', '']) {
    const result = await json(`/api/v1/orders?limit=${bad}`);
    assert.equal(result.status, 400, `limit=${bad}`);
    assert.equal(result.body.error.code, 'INVALID_REQUEST');
  }
  const one = await json('/api/v1/orders?limit=1');
  assert.equal(one.body.data.items.length, 1);
  assert.equal(one.body.data.pagination.hasMore, true);
});

test('search and date filters run correctly against real SQL (and are injection-safe)', opts, async () => {
  const ids = async (query, scope) => (await json(query, scope)).body.data.items.map((i) => i.id).sort();
  const a = [1, 2, 3, 4, 5, 6].map(O).sort();
  assert.deepEqual(await ids('/api/v1/orders?search=VHT-A1'), [O(1)], 'order number prefix');
  assert.deepEqual(await ids('/api/v1/orders?search=vht-a1'), [O(1)], 'case-insensitive');
  assert.deepEqual(await ids('/api/v1/orders?search=asha@example'), a, 'email contains');
  assert.deepEqual(await ids('/api/v1/orders?search=9811111111'), a, 'phone contains');
  assert.deepEqual(await ids('/api/v1/orders?search=ASHA'), a, 'first name');
  assert.deepEqual(await ids('/api/v1/orders?search=rao'), a, 'last name');
  assert.deepEqual(await ids('/api/v1/orders?search=bhanu'), [O(7), O(8)].sort(), 'user without last name');
  assert.deepEqual(await ids('/api/v1/orders?search=account.b'), [O(7), O(8)].sort(), 'account email');
  for (const guestTerm of ['guest@example.com', 'Gita', '9833333333', 'VHT-G']) {
    assert.deepEqual(await ids(`/api/v1/orders?search=${encodeURIComponent(guestTerm)}`), [], `guest term "${guestTerm}"`);
  }
  assert.deepEqual(await ids('/api/v1/orders?search=%25'), [], '% is a literal, not a wildcard');
  assert.deepEqual(await ids('/api/v1/orders?search=_'), [], '_ is a literal, not a wildcard');
  assert.deepEqual(await ids("/api/v1/orders?search=" + encodeURIComponent("'; DROP TABLE orders; --")), []);
  assert.deepEqual(await ids("/api/v1/orders?search=" + encodeURIComponent("' OR '1'='1")), []);
  assert.equal((await seed.$queryRawUnsafe('SELECT count(*)::int AS n FROM orders'))[0].n, 10, 'orders table intact');

  assert.deepEqual(await ids('/api/v1/orders?fromDate=2026-10-04&toDate=2026-10-05'), [O(4), O(5), O(6)].sort(), 'whole toDate day included');
  assert.deepEqual(await ids('/api/v1/orders?fromDate=2026-10-05T10:00:01Z'), [O(7), O(8)].sort());
  assert.deepEqual(await ids('/api/v1/orders?toDate=2026-10-01'), [O(1)]);
  assert.equal((await json('/api/v1/orders?fromDate=2026-10-05&toDate=2026-10-01')).status, 400);
});

test('GET /orders/:orderId returns the complete order with payments and transactions', opts, async () => {
  const { status, body } = await json(`/api/v1/orders/${O(1)}`);
  assert.equal(status, 200);
  const { order: o, customer, shippingAddress, items, payments } = body.data;
  assert.equal(o.id, O(1));
  assert.equal(o.userId, U_A);
  assert.equal(o.customerType, 'REGISTERED');
  assert.equal(o.totalAmount, 550);
  assert.ok(o.confirmedAt && o.paidAt && o.paymentExpiresAt && o.createdAt && o.updatedAt);
  assert.equal(o.cancelledAt, null);
  assert.deepEqual(customer, { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+919811111111' });
  assert.equal(shippingAddress.addressLine1, '1 Main St');
  assert.equal(shippingAddress.country, 'IN');
  assert.deepEqual(items.map((i) => [i.productName, i.unitPrice, i.quantity, i.totalPrice]).sort(), [['Chakli', 150, 2, 300], ['Laddu', 200, 1, 200]].sort());

  assert.deepEqual(payments.map((p) => p.attemptNumber), [2, 1], 'attempt_number DESC');
  const [captured, failed] = payments;
  assert.equal(captured.status, 'CAPTURED');
  assert.equal(captured.gateway, 'RAZORPAY');
  assert.equal(captured.razorpayOrderId, 'order_t2');
  assert.equal(captured.methodDetails.upiHandleMasked, 'as***@okhdfc');
  assert.equal(captured.methodDetails.card, null);
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(failed.methodDetails.card, { network: 'Visa', last4: '1111', type: 'debit', issuer: 'HDFC' });
  assert.equal(failed.failureCode, 'BAD_REQUEST_ERROR');
  assert.equal(failed.failureReason, 'Card declined');
  assert.deepEqual(captured.transactions.map((t) => t.type), ['CAPTURE', 'AUTHORIZATION', 'ATTEMPT'], 'newest first');
  assert.equal(captured.transactions[0].webhookEventId, id('4', 1));
  assert.equal(captured.transactions[0].source, 'WEBHOOK');
  assert.deepEqual(failed.transactions.map((t) => t.type), ['FAILURE', 'ATTEMPT']);
  assert.equal(failed.transactions[0].errorCode, 'BAD_REQUEST_ERROR');

  const text = JSON.stringify(body);
  for (const leaked of ['LEAK-ME-SECRET', '4111111111111111', '737', 'gateway_response', 'gatewayResponse', 'idempotency', 't-a1-5',
    'ffffffffffffffff', 'google', 'account.a@example.com']) {
    assert.equal(text.includes(leaked), false, `${leaked} must not be exposed`);
  }
});

test('order details: refund transactions, missing metadata, empty payments', opts, async () => {
  const refunded = (await json(`/api/v1/orders/${O(5)}`)).body.data;
  assert.equal(refunded.payments[0].status, 'PARTIALLY_REFUNDED');
  assert.equal(refunded.payments[0].amountRefunded, 100);
  const refund = refunded.payments[0].transactions[0];
  assert.deepEqual([refund.type, refund.razorpayRefundId, refund.amount], ['REFUND', 'rfnd_t6', 100]);

  const pending = (await json(`/api/v1/orders/${O(4)}`)).body.data;
  assert.equal(pending.payments[0].status, 'PENDING');
  assert.equal(pending.payments[0].method, null);
  assert.equal(pending.payments[0].methodSummary, null);
  assert.deepEqual(pending.payments[0].methodDetails, { card: null, bankCode: null, walletName: null, upiHandleMasked: null });
  assert.deepEqual(pending.payments[0].transactions, []);

  const netbanking = (await json(`/api/v1/orders/${O(3)}`)).body.data;
  assert.equal(netbanking.payments[0].methodDetails.bankCode, 'HDFC');
  assert.equal(netbanking.payments[0].methodSummary, 'HDFC netbanking');

  const cancelled = (await json(`/api/v1/orders/${O(6)}`)).body.data;
  assert.deepEqual(cancelled.payments, []);
  assert.ok(cancelled.order.cancelledAt);

  const authorized = (await json(`/api/v1/orders/${O(8)}`)).body.data;
  assert.equal(authorized.payments[0].status, 'AUTHORIZED');
  assert.equal(authorized.payments[0].methodDetails.card.last4, null, 'card without last4');
});

test('guest order ids and unknown ids give the identical 404', opts, async () => {
  const missing = await json(`/api/v1/orders/${id('9', 1)}`);
  assert.equal(missing.status, 404);
  for (const guest of GUEST_IDS) {
    const result = await json(`/api/v1/orders/${guest}`);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, missing.body);
  }
  assert.equal((await json('/api/v1/orders/not-a-uuid')).status, 400);
});

test('GET /users/:userId/orders: scoped to the user, filters, pagination, empty and unknown', opts, async () => {
  const path = (user, query = '') => `/api/v1/users/${user}/orders${query}`;
  const forA = await json(path(U_A), 'orders:user:read');
  assert.equal(forA.status, 200);
  assert.equal(forA.body.message, 'User orders retrieved successfully');
  assert.deepEqual(forA.body.data.items.map((i) => i.id), [O(6), ...[O(4), O(5)].sort().reverse(), O(3), O(2), O(1)]);
  assert.ok(forA.body.data.items.every((i) => i.userId === U_A));

  const forB = await json(path(U_B), 'orders:user:read');
  assert.deepEqual(forB.body.data.items.map((i) => i.id), [O(8), O(7)]);

  const empty = await json(path(U_C), 'orders:user:read');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { success: true, data: { items: [], pagination: { nextCursor: null, hasMore: false } }, message: 'No orders found' });

  const unknown = await json(path(id('9', 7)), 'orders:user:read');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'USER_NOT_FOUND');
  assert.equal((await json(path('nope'), 'orders:user:read')).body.error.code, 'INVALID_USER_ID');

  // filters across pages
  const seen = [];
  let cursor;
  do {
    const page = await json(path(U_A, `?limit=1&status=PAID${cursor ? `&cursor=${cursor}` : ''}`), 'orders:user:read');
    seen.push(...page.body.data.items.map((i) => i.id));
    cursor = page.body.data.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [O(2), O(1)]);
  assert.deepEqual((await json(path(U_A, '?paymentStatus=PARTIALLY_REFUNDED'), 'orders:user:read')).body.data.items.map((i) => i.id), [O(5)]);

  // a cursor is bound to its user
  const pageA = await json(path(U_A, '?limit=1'), 'orders:user:read');
  const crossUser = await json(path(U_B, `?limit=1&cursor=${pageA.body.data.pagination.nextCursor}`), 'orders:user:read');
  assert.equal(crossUser.status, 400);
  assert.equal((await json(path(U_A, '?limit=51'), 'orders:user:read')).status, 400);
});

test('only parameterised, read-only SELECTs ran, none touching guest tables, and no data changed', opts, async () => {
  const before = await checksums();
  const marker = 'zz-unique-search-marker';
  statements.length = 0;
  await json(`/api/v1/orders?limit=7&status=PAID&paymentStatus=CAPTURED&search=${marker}&fromDate=2026-10-01&toDate=2026-10-30`);
  await json(`/api/v1/orders/${O(1)}`);
  await json(`/api/v1/users/${U_A}/orders?limit=4&status=PAID`, 'orders:user:read');
  assert.deepEqual(await checksums(), before, 'no row in any order table changed');

  assert.equal(statements.length, 7, "list 1 + detail 4 (order, items, payments, transactions) + user list 2 (user, orders)");
  for (const sql of statements) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b/i);
    assert.doesNotMatch(sql, /guest_checkout_sessions|guest_access_token|guest_session_id|google_id|gateway_response|webhook_events|idempotency_key/i);
    assert.doesNotMatch(sql, /OFFSET/i);
    assert.equal(sql.includes(marker), false, 'request values are bound parameters, never part of the SQL text');
    for (const value of ['PAID', 'CAPTURED', '2026-10-01', U_A, O(1)]) {
      assert.equal(sql.includes(value), false, `${value} is bound, not interpolated`);
    }
  }
  const listSql = statements.find((sql) => /ORDER BY o\.created_at DESC, o\.id DESC/.test(sql));
  assert.match(listSql, /LIMIT \$\d+\s*$/, 'the page size is a bound parameter');
});

test('a new order created between page requests causes no duplicate or missing rows', opts, async () => {
  const first = await json('/api/v1/orders?limit=3');
  const firstIds = first.body.data.items.map((i) => i.id);
  await order(11, { user: U_B, number: 'VHT-B3', email: 'bhanu@example.com', phone: '+919822222222', status: 'PENDING_PAYMENT', created: '2026-12-01T00:00:00Z' });
  try {
    const rest = [];
    let cursor = first.body.data.pagination.nextCursor;
    while (cursor) {
      const page = await json(`/api/v1/orders?limit=3&cursor=${cursor}`);
      rest.push(...page.body.data.items.map((i) => i.id));
      cursor = page.body.data.pagination.nextCursor;
    }
    assert.deepEqual([...firstIds, ...rest], REGISTERED_NEWEST_FIRST(), 'the same original sequence, nothing repeated or skipped');
    assert.equal((await json('/api/v1/orders?limit=1')).body.data.items[0].id, O(11), 'a fresh request sees the new order first');
  } finally {
    await run(`DELETE FROM order_items WHERE order_id = '${O(11)}'`);
    await run(`DELETE FROM orders WHERE id = '${O(11)}'`);
  }
});
