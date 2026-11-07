const { OrderApiError } = require('./order.errors');
const orderRepository = require('./order.repository');
const { toRegisteredOrderPage, toRegisteredOrderDetail } = require('./order.mapper');
const {
  parseOrderQuery,
  validateOrderId,
  validateUserId
} = require('./order.validation');

// Orders and payments live in the main application's tables and are read through the read-only
// repository, which excludes guest orders in every query. The service validates input, maps
// repository errors to API errors and shapes the response.

// An unusable cursor is reported as a normal 400 INVALID_REQUEST pointing at the cursor field.
const withCursorErrors = async (action) => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof OrderApiError && error.code === 'INVALID_CURSOR') {
      throw new OrderApiError(400, 'INVALID_REQUEST', 'Invalid request', [{ field: 'cursor', message: 'cursor is invalid' }]);
    }
    throw error;
  }
};

const listOrders = async (rawQuery) => {
  const { limit, cursor, ...filters } = parseOrderQuery(rawQuery, { search: true, dates: true });
  return withCursorErrors(async () =>
    toRegisteredOrderPage(await orderRepository.findAllUserOrders(filters, { limit, cursor })));
};

// A missing order and a guest order are indistinguishable: the repository never returns guests.
const getOrder = async (rawOrderId) => {
  const orderId = validateOrderId(rawOrderId);
  const order = await orderRepository.findOrderWithDetails(orderId);
  if (!order) {
    throw new OrderApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return toRegisteredOrderDetail(order);
};

// Input is fully validated before any database access; then the user must exist (404
// USER_NOT_FOUND) so "no orders" can be told apart from "no such user".
const listUserOrders = async (rawUserId, rawQuery) => {
  const userId = validateUserId(rawUserId);
  const { limit, cursor, status, paymentStatus } = parseOrderQuery(rawQuery);
  const user = await orderRepository.findUserById(userId);
  if (!user) {
    throw new OrderApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return withCursorErrors(async () =>
    toRegisteredOrderPage(await orderRepository.findOrdersByUserId(userId, { status, paymentStatus }, { limit, cursor })));
};

module.exports = { listOrders, getOrder, listUserOrders };
