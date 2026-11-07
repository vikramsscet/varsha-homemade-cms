// Maps raw rows from the order tables to the camelCase view the order service/mapper consume.
// Only an explicit allowlist of columns is ever read by the repository, so secrets such as
// google_id, guest tokens and gateway payloads are not even selected.

const text = (value) => (value === null || value === undefined ? null : String(value).trim());
const number = (value) => (value === null || value === undefined ? null : Number(value));
const iso = (value) => {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
};

const NETWORKS = {
  VISA: 'Visa', MASTERCARD: 'Mastercard', RUPAY: 'RuPay', AMERICAN_EXPRESS: 'American Express',
  AMEX: 'American Express', DINERS_CLUB: 'Diners Club', DISCOVER: 'Discover', JCB: 'JCB',
  MAESTRO: 'Maestro', UNIONPAY: 'UnionPay', BAJAJ: 'Bajaj Finserv'
};
const titleCase = (value) => String(value).toLowerCase().split(/[_\s]+/).filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
const networkLabel = (network) => (network ? NETWORKS[network] || titleCase(network) : null);

// Display label built from stored non-sensitive metadata only (never a full UPI handle).
const paymentMethodSummary = ({ method, cardNetwork, cardLast4, bankCode, walletName }) => {
  switch (method) {
    case null:
    case undefined:
      return null;
    case 'card': {
      const network = networkLabel(cardNetwork);
      if (network && cardLast4) return `${network} •••• ${cardLast4}`;
      if (cardLast4) return `Card •••• ${cardLast4}`;
      return network ? `${network} card` : 'Card';
    }
    case 'upi':
      return 'UPI';
    case 'netbanking':
      return bankCode ? `${bankCode} netbanking` : 'Netbanking';
    case 'wallet':
      return walletName ? titleCase(walletName) : 'Wallet';
    default:
      return titleCase(method);
  }
};

const toCustomer = (row) => ({
  userId: text(row.user_id),
  firstName: text(row.user_first_name),
  lastName: text(row.user_last_name),
  // Order-time snapshot first; the account email only as a fallback.
  email: text(row.customer_email) || text(row.user_email),
  phone: text(row.customer_phone),
  customerType: 'REGISTERED' // guest orders are excluded by every query
});

const toPricing = (row) => ({
  currency: text(row.currency),
  subtotal: number(row.subtotal),
  discountAmount: number(row.discount_amount),
  taxAmount: number(row.tax_amount),
  shippingAmount: number(row.shipping_amount),
  totalAmount: number(row.total_amount)
});

// Listing row: order + customer + the LATEST payment attempt only.
const toOrderListItem = (row) => {
  const latestPayment = row.payment_status
    ? {
      status: text(row.payment_status),
      method: text(row.payment_method),
      cardNetwork: text(row.card_network),
      cardLast4: text(row.card_last4),
      bankCode: text(row.bank_code),
      walletName: text(row.wallet_name),
      upiHandleMasked: text(row.upi_handle_masked)
    }
    : null;
  return {
    id: text(row.id),
    orderNumber: text(row.order_number),
    status: text(row.status),
    ...toPricing(row),
    paymentStatus: latestPayment ? latestPayment.status : null,
    paymentMethodSummary: latestPayment ? paymentMethodSummary(latestPayment) : null,
    latestPayment,
    customer: toCustomer(row),
    createdAt: iso(row.created_at),
    paidAt: iso(row.paid_at),
    // Microsecond text timestamp used to build the next-page cursor; not part of the public view.
    cursorCreatedAt: row.cursor_created_at
  };
};

const toOrder = (row) => ({
  id: text(row.id),
  orderNumber: text(row.order_number),
  status: text(row.status),
  ...toPricing(row),
  customer: toCustomer(row),
  shippingAddress: {
    firstName: text(row.shipping_first_name),
    lastName: text(row.shipping_last_name),
    phone: text(row.shipping_phone),
    country: text(row.shipping_country),
    addressLine1: text(row.shipping_address_line1),
    addressLine2: text(row.shipping_address_line2),
    city: text(row.shipping_city),
    state: text(row.shipping_state),
    postalCode: text(row.shipping_postal_code)
  },
  confirmedAt: iso(row.confirmed_at),
  paidAt: iso(row.paid_at),
  cancelledAt: iso(row.cancelled_at),
  paymentExpiresAt: iso(row.payment_expires_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

const toOrderItem = (row) => ({
  id: text(row.id),
  createdAt: iso(row.created_at),
  productId: text(row.product_id),
  productName: text(row.product_name),
  productSlug: text(row.product_slug),
  unitPrice: number(row.unit_price),
  quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
  totalPrice: number(row.total_price)
});

const toPayment = (row) => {
  const metadata = {
    method: text(row.method),
    cardNetwork: text(row.card_network),
    cardLast4: text(row.card_last4),
    bankCode: text(row.bank_code),
    walletName: text(row.wallet_name)
  };
  return {
    paymentId: text(row.id),
    gateway: text(row.gateway),
    razorpayOrderId: text(row.razorpay_order_id),
    attemptNumber: row.attempt_number === null || row.attempt_number === undefined ? null : Number(row.attempt_number),
    razorpayPaymentId: text(row.razorpay_payment_id),
    paymentStatus: text(row.status),
    paymentMethod: metadata.method,
    paymentMethodSummary: paymentMethodSummary(metadata),
    amount: number(row.amount),
    amountRefunded: number(row.amount_refunded),
    currency: text(row.currency),
    card: metadata.method === 'card'
      ? {
        network: networkLabel(metadata.cardNetwork),
        last4: metadata.cardLast4,
        type: row.card_type ? String(row.card_type).toLowerCase() : null,
        issuer: text(row.card_issuer)
      }
      : null,
    bankCode: metadata.method === 'netbanking' ? metadata.bankCode : null,
    walletName: metadata.method === 'wallet' ? metadata.walletName : null,
    upiHandleMasked: metadata.method === 'upi' ? text(row.upi_handle_masked) : null,
    failureCode: text(row.failure_code),
    failureReason: text(row.failure_reason),
    createdAt: iso(row.created_at),
    authorizedAt: iso(row.authorized_at),
    capturedAt: iso(row.captured_at),
    failedAt: iso(row.failed_at),
    updatedAt: iso(row.updated_at)
  };
};

const toPaymentTransaction = (row) => ({
  transactionId: text(row.id),
  paymentId: text(row.payment_id),
  type: text(row.type),
  status: text(row.status),
  amount: number(row.amount),
  currency: text(row.currency),
  razorpayPaymentId: text(row.razorpay_payment_id),
  razorpayRefundId: text(row.razorpay_refund_id),
  source: text(row.source),
  webhookEventId: text(row.webhook_event_id),
  errorCode: text(row.error_code),
  errorDescription: text(row.error_description),
  createdAt: iso(row.created_at)
});

const toUser = (row) => ({
  id: text(row.id),
  email: text(row.email),
  firstName: text(row.first_name),
  lastName: text(row.last_name),
  status: text(row.status)
});

module.exports = {
  paymentMethodSummary,
  toOrderListItem,
  toOrder,
  toOrderItem,
  toPayment,
  toPaymentTransaction,
  toUser
};
