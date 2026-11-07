const orderService = require('./order.service');
const { OrderApiError } = require('./order.errors');

const sendSuccess = (res, data, message) => {
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, data, message });
};

const sendError = (res, error) => {
  if (error instanceof OrderApiError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return res.status(error.statusCode).json({ success: false, error: body });
  }
  console.error('Unexpected error handling order request:', error?.name, error?.code);
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' }
  });
};

// `message` is a string or a function of the result.
const handle = (action, message) => async (req, res) => {
  try {
    const data = await action(req);
    return sendSuccess(res, data, typeof message === 'function' ? message(data) : message);
  } catch (error) {
    return sendError(res, error);
  }
};

const listOrders = handle((req) => orderService.listOrders(req.query), 'Orders retrieved successfully');
const getOrder = handle((req) => orderService.getOrder(req.params.orderId), 'Order retrieved successfully');
const listUserOrders = handle(
  (req) => orderService.listUserOrders(req.params.userId, req.query),
  (page) => (page.items.length === 0 ? 'No orders found' : 'User orders retrieved successfully')
);

module.exports = { listOrders, getOrder, listUserOrders };
