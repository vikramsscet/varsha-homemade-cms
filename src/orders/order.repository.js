const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const cursorUtil = require('./order.cursor');
const mapper = require('./order.db-mapper');

// Read-only data access for the order tables owned by user-and-cart-service
// (users, orders, order_items, payments, payment_transactions). The tables are not Prisma
// models, so queries use parameterised Prisma.sql fragments through $queryRaw: every value is
// bound as a parameter, only fixed SQL text is concatenated, and nothing here writes
// (payment_transactions additionally has a trigger that rejects UPDATE/DELETE).
//
// GUEST EXCLUSION: every query that reads orders - directly or through order_items, payments or
// payment_transactions - carries `customer_type = 'USER' AND user_id IS NOT NULL`. Guest orders,
// guest sessions and guest access tokens are never selected.
//
// INDEXES REUSED (migrations 005, 006, 011):
//   idx_orders_user_history        (user_id, created_at DESC, id DESC) WHERE user_id IS NOT NULL
//   idx_orders_user_status_history (user_id, status, created_at DESC, id DESC) WHERE user_id IS NOT NULL
//   idx_payments_order             (order_id, attempt_number DESC)  -> latest-payment lookup
//   uq_order_items_order_product   (order_id, product_id)           -> item lookup
//   idx_payment_transactions_payment (payment_id, created_at)       -> transaction lookup
//   orders / users primary keys
// RECOMMENDED (not applied; owned by the main service's migrations): see docs in the PR notes -
//   CREATE INDEX idx_orders_registered_history ON orders (created_at DESC, id DESC)
//     WHERE customer_type = 'USER' AND user_id IS NOT NULL;
//   CREATE INDEX idx_orders_registered_status_history ON orders (status, created_at DESC, id DESC)
//     WHERE customer_type = 'USER' AND user_id IS NOT NULL;

const { sql, join } = Prisma;

const REGISTERED_ORDER = sql`o.customer_type = 'USER' AND o.user_id IS NOT NULL`;

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const query = (fragment) => prisma.$queryRaw(fragment);

// Microsecond-exact text timestamp for the cursor.
const CURSOR_CREATED_AT = sql`to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Latest payment ATTEMPT per order: one index probe on idx_payments_order per listed order,
// never a join of all attempts.
const LATEST_PAYMENT = sql`
  LEFT JOIN LATERAL (
    SELECT status, method, card_network, card_last4, bank_code, wallet_name, upi_handle_masked
      FROM payments
     WHERE order_id = o.id
     ORDER BY attempt_number DESC
     LIMIT 1
  ) p ON TRUE`;

const ORDER_LIST_COLUMNS = sql`
  o.id, o.order_number, o.status, o.currency, o.subtotal, o.discount_amount, o.tax_amount,
  o.shipping_amount, o.total_amount, o.user_id, o.customer_email, o.customer_phone,
  o.created_at, o.paid_at,
  u.first_name AS user_first_name, u.last_name AS user_last_name`;

// Builds and runs one keyset page. `userId`, when given, narrows to that user's orders.
const listOrderPage = async ({ userId, filters = {}, limit, cursor }) => {
  const { status, paymentStatus, search, createdFrom, createdBefore } = filters;
  const pageLimit = cursorUtil.normalizeLimit(limit);
  // The fingerprint covers every filter, including the user, so a cursor only continues the
  // exact query that produced it.
  const fingerprint = cursorUtil.filterFingerprint({ userId, status, paymentStatus, search, createdFrom, createdBefore });
  const after = cursor ? cursorUtil.decodeCursor(cursor, fingerprint) : null;

  const conditions = [REGISTERED_ORDER];
  if (userId) conditions.push(sql`o.user_id = ${userId}::uuid`);
  if (status) conditions.push(sql`o.status = ${status}`);
  if (paymentStatus) conditions.push(sql`p.status = ${paymentStatus}`);
  if (createdFrom) conditions.push(sql`o.created_at >= ${createdFrom}::timestamptz`);
  if (createdBefore) conditions.push(sql`o.created_at < ${createdBefore}::timestamptz`);
  if (search) {
    const escaped = escapeLike(search);
    const prefix = `${escaped}%`;
    const contains = `%${escaped.toLowerCase()}%`;
    conditions.push(sql`(
      o.order_number ILIKE ${prefix} ESCAPE '\\'
      OR lower(o.customer_email) LIKE ${contains} ESCAPE '\\'
      OR lower(u.email) LIKE ${contains} ESCAPE '\\'
      OR o.customer_phone LIKE ${contains} ESCAPE '\\'
      OR lower(concat_ws(' ', u.first_name, u.last_name)) LIKE ${contains} ESCAPE '\\'
    )`);
  }
  if (after) {
    conditions.push(sql`(o.created_at, o.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`);
  }

  const rows = await query(sql`
    SELECT ${ORDER_LIST_COLUMNS}, ${CURSOR_CREATED_AT} AS cursor_created_at,
           p.status AS payment_status, p.method AS payment_method, p.card_network, p.card_last4,
           p.bank_code, p.wallet_name, p.upi_handle_masked
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ${LATEST_PAYMENT}
     WHERE ${join(conditions, ' AND ')}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ${pageLimit + 1}`);

  return cursorUtil.buildPage(rows.map(mapper.toOrderListItem), pageLimit, fingerprint);
};

// Orders of all registered users, newest first.
// filters: { status, paymentStatus, search, createdFrom, createdBefore }  pagination: { limit, cursor }
const findAllUserOrders = (filters = {}, pagination = {}) =>
  listOrderPage({ filters, limit: pagination.limit, cursor: pagination.cursor });

// Orders of one registered user, newest first. filters: { status, paymentStatus }
const findOrdersByUserId = (userId, filters = {}, pagination = {}) =>
  listOrderPage({
    userId,
    filters: { status: filters.status, paymentStatus: filters.paymentStatus },
    limit: pagination.limit,
    cursor: pagination.cursor
  });

// A single registered-user order with customer and historical shipping snapshot; null if it
// does not exist or is a guest order (indistinguishable to the caller).
const findOrderById = async (orderId) => {
  const rows = await query(sql`
    SELECT o.id, o.order_number, o.status, o.currency, o.subtotal, o.discount_amount, o.tax_amount,
           o.shipping_amount, o.total_amount, o.user_id, o.customer_email, o.customer_phone,
           o.shipping_first_name, o.shipping_last_name, o.shipping_phone, o.shipping_country,
           o.shipping_address_line1, o.shipping_address_line2, o.shipping_city, o.shipping_state,
           o.shipping_postal_code, o.confirmed_at, o.paid_at, o.cancelled_at, o.payment_expires_at,
           o.created_at, o.updated_at,
           u.first_name AS user_first_name, u.last_name AS user_last_name, u.email AS user_email
      FROM orders o
      JOIN users u ON u.id = o.user_id
     WHERE o.id = ${orderId}::uuid AND ${REGISTERED_ORDER}`);
  return rows[0] ? mapper.toOrder(rows[0]) : null;
};

// The child lookups join back to orders purely to re-apply the guest exclusion, so calling them
// with a guest order id returns nothing even without going through findOrderById.
const findOrderItems = async (orderId) => {
  const rows = await query(sql`
    SELECT oi.id, oi.created_at, oi.product_id, oi.product_name, oi.product_slug, oi.unit_price, oi.quantity, oi.total_price
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE oi.order_id = ${orderId}::uuid AND ${REGISTERED_ORDER}
     ORDER BY oi.created_at, oi.product_id`);
  return rows.map(mapper.toOrderItem);
};

// Every payment attempt, newest first.
const findOrderPayments = async (orderId) => {
  const rows = await query(sql`
    SELECT pay.id, pay.attempt_number, pay.gateway, pay.razorpay_order_id, pay.razorpay_payment_id, pay.status, pay.method, pay.amount,
           pay.amount_refunded, pay.currency, pay.card_network, pay.card_last4, pay.card_type,
           pay.card_issuer, pay.bank_code, pay.wallet_name, pay.upi_handle_masked, pay.failure_code,
           pay.failure_reason, pay.created_at, pay.updated_at, pay.authorized_at, pay.captured_at, pay.failed_at
      FROM payments pay
      JOIN orders o ON o.id = pay.order_id
     WHERE pay.order_id = ${orderId}::uuid AND ${REGISTERED_ORDER}
     ORDER BY pay.attempt_number DESC`);
  return rows.map(mapper.toPayment);
};

// Transactions for many payment attempts in ONE query (no N+1). gateway_response, idempotency
// keys are deliberately not selected. Returns a Map<paymentId, transaction[]>
// with each list newest first.
const findPaymentTransactions = async (paymentIds) => {
  const byPayment = new Map();
  const ids = [...new Set((paymentIds || []).filter(Boolean))];
  if (ids.length === 0) return byPayment;

  const rows = await query(sql`
    SELECT pt.id, pt.payment_id, pt.type, pt.status, pt.amount, pt.currency, pt.razorpay_payment_id,
           pt.razorpay_refund_id, pt.source, pt.webhook_event_id, pt.error_code, pt.error_description, pt.created_at
      FROM payment_transactions pt
      JOIN payments pay ON pay.id = pt.payment_id
      JOIN orders o ON o.id = pay.order_id
     WHERE pt.payment_id = ANY(${ids}::uuid[]) AND ${REGISTERED_ORDER}
     ORDER BY pt.created_at DESC, pt.id DESC`);

  for (const row of rows) {
    const transaction = mapper.toPaymentTransaction(row);
    if (!byPayment.has(transaction.paymentId)) byPayment.set(transaction.paymentId, []);
    byPayment.get(transaction.paymentId).push(transaction);
  }
  return byPayment;
};

// Complete order: order, items, all payment attempts, each attempt's transactions. Items and
// payments are separate queries (no row-multiplying joins); transactions follow in one query.
const findOrderWithDetails = async (orderId) => {
  const order = await findOrderById(orderId);
  if (!order) return null;
  const [items, payments] = await Promise.all([findOrderItems(order.id), findOrderPayments(order.id)]);
  const transactions = await findPaymentTransactions(payments.map((payment) => payment.paymentId));
  return {
    ...order,
    items,
    payments: payments.map((payment) => ({ ...payment, transactions: transactions.get(payment.paymentId) || [] }))
  };
};

// Registered user lookup (existence check for the per-user endpoint). Selects no credentials
// or provider ids (google_id is never read).
const findUserById = async (userId) => {
  const rows = await query(sql`
    SELECT id, email, first_name, last_name, status FROM users WHERE id = ${userId}::uuid`);
  return rows[0] ? mapper.toUser(rows[0]) : null;
};

module.exports = {
  findAllUserOrders,
  findOrderById,
  findOrdersByUserId,
  findOrderItems,
  findOrderPayments,
  findPaymentTransactions,
  findOrderWithDetails,
  findUserById
};
