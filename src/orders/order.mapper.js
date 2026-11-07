// Response views for the order APIs. Each is an explicit allowlist built from the repository's
// mapped rows, so nothing outside these fields can reach the admin UI.

// Repository-backed listing (registered users only): flat order summary with the latest payment.
const toRegisteredOrderSummary = (order) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  userId: order.customer.userId,
  customer: {
    firstName: order.customer.firstName,
    lastName: order.customer.lastName,
    email: order.customer.email,
    phone: order.customer.phone
  },
  status: order.status,
  currency: order.currency,
  subtotal: order.subtotal,
  discountAmount: order.discountAmount,
  taxAmount: order.taxAmount,
  shippingAmount: order.shippingAmount,
  totalAmount: order.totalAmount,
  paymentStatus: order.latestPayment ? order.latestPayment.status : null,
  paymentMethod: order.latestPayment ? order.latestPayment.method : null,
  paymentMethodSummary: order.paymentMethodSummary,
  createdAt: order.createdAt,
  paidAt: order.paidAt
});

const toRegisteredOrderPage = (page) => ({
  items: page.items.map(toRegisteredOrderSummary),
  pagination: { nextCursor: page.pagination.nextCursor, hasMore: page.pagination.hasMore }
});

// Repository-backed order detail. Sections: order, customer, shippingAddress, items, payments;
// each payment carries its own `transactions` (newest first). No raw gateway_response, gateway
// credentials, idempotency keys or full instrument data are ever part of the source rows.
const toRegisteredOrderTransaction = (transaction) => ({
  id: transaction.transactionId,
  paymentId: transaction.paymentId,
  type: transaction.type,
  status: transaction.status,
  amount: transaction.amount,
  currency: transaction.currency,
  razorpayPaymentId: transaction.razorpayPaymentId,
  razorpayRefundId: transaction.razorpayRefundId,
  source: transaction.source,
  webhookEventId: transaction.webhookEventId,
  errorCode: transaction.errorCode,
  errorDescription: transaction.errorDescription,
  createdAt: transaction.createdAt
});

const toRegisteredOrderPayment = (payment) => ({
  id: payment.paymentId,
  attemptNumber: payment.attemptNumber,
  gateway: payment.gateway,
  razorpayOrderId: payment.razorpayOrderId,
  razorpayPaymentId: payment.razorpayPaymentId,
  status: payment.paymentStatus,
  currency: payment.currency,
  amount: payment.amount,
  amountRefunded: payment.amountRefunded,
  method: payment.paymentMethod,
  methodSummary: payment.paymentMethodSummary,
  methodDetails: {
    card: payment.card,
    bankCode: payment.bankCode,
    walletName: payment.walletName,
    upiHandleMasked: payment.upiHandleMasked
  },
  failureCode: payment.failureCode,
  failureReason: payment.failureReason,
  authorizedAt: payment.authorizedAt,
  capturedAt: payment.capturedAt,
  failedAt: payment.failedAt,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
  transactions: payment.transactions.map(toRegisteredOrderTransaction)
});

const toRegisteredOrderDetail = (order) => ({
  order: {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.customer.userId,
    customerType: order.customer.customerType,
    status: order.status,
    currency: order.currency,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxAmount: order.taxAmount,
    shippingAmount: order.shippingAmount,
    totalAmount: order.totalAmount,
    confirmedAt: order.confirmedAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    paymentExpiresAt: order.paymentExpiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  },
  customer: {
    firstName: order.customer.firstName,
    lastName: order.customer.lastName,
    email: order.customer.email,
    phone: order.customer.phone
  },
  shippingAddress: order.shippingAddress,
  items: order.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    createdAt: item.createdAt
  })),
  payments: order.payments.map(toRegisteredOrderPayment)
});

module.exports = { toRegisteredOrderPage, toRegisteredOrderDetail };
