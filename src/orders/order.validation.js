const { OrderApiError } = require('./order.errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAID', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 100;

const invalid = (details) => new OrderApiError(400, 'INVALID_REQUEST', 'Invalid request', details);

const validateUuid = (value, field, code) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new OrderApiError(400, code, `${field} must be a valid UUID`);
  }
  return value.toLowerCase();
};

const validateOrderId = (value) => validateUuid(value, 'Order ID', 'INVALID_ORDER_ID');
const validateUserId = (value) => validateUuid(value, 'User ID', 'INVALID_USER_ID');

// A date-only value is a calendar day in UTC; fromDate starts at 00:00:00Z and a
// date-only toDate includes the whole day (exclusive bound = next day 00:00:00Z).
const parseDate = (value, field, errors, { endOfRange }) => {
  const dateOnly = DATE_ONLY_PATTERN.test(value);
  if (!dateOnly && !DATE_TIME_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be an ISO 8601 date (YYYY-MM-DD) or date-time` });
    return undefined;
  }
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) {
    errors.push({ field, message: `${field} is not a valid date` });
    return undefined;
  }
  if (dateOnly && endOfRange) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
};

// Only an explicit allowlist of query parameters is ever read; everything else is ignored
// and nothing from the request is passed on as a filter expression.
const parseOrderQuery = (query = {}, { search = false, dates = false } = {}) => {
  const errors = [];
  const out = {};
  const read = (name) => {
    const value = query[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      errors.push({ field: name, message: `${name} must be a single value` });
      return undefined;
    }
    return value;
  };

  const limit = read('limit');
  if (limit === undefined) {
    out.limit = DEFAULT_LIMIT;
  } else if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    errors.push({ field: 'limit', message: `limit must be an integer between 1 and ${MAX_LIMIT}` });
  } else {
    out.limit = Number(limit);
  }

  const cursor = read('cursor');
  if (cursor !== undefined) {
    if (!CURSOR_PATTERN.test(cursor)) {
      errors.push({ field: 'cursor', message: 'cursor is invalid' });
    } else {
      out.cursor = cursor;
    }
  }

  const status = read('status');
  if (status !== undefined) {
    if (!ORDER_STATUSES.includes(status)) {
      errors.push({ field: 'status', message: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
    } else {
      out.status = status;
    }
  }

  const paymentStatus = read('paymentStatus');
  if (paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) {
      errors.push({ field: 'paymentStatus', message: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}` });
    } else {
      out.paymentStatus = paymentStatus;
    }
  }

  if (search) {
    const term = read('search');
    if (term !== undefined) {
      const trimmed = term.trim();
      if (trimmed.length < 1 || trimmed.length > MAX_SEARCH_LENGTH || CONTROL_CHARS.test(trimmed)) {
        errors.push({ field: 'search', message: `search must be 1-${MAX_SEARCH_LENGTH} printable characters` });
      } else {
        out.search = trimmed;
      }
    }
  }

  if (dates) {
    const fromRaw = read('fromDate');
    const toRaw = read('toDate');
    const from = fromRaw === undefined ? undefined : parseDate(fromRaw, 'fromDate', errors, { endOfRange: false });
    const to = toRaw === undefined ? undefined : parseDate(toRaw, 'toDate', errors, { endOfRange: true });
    if (from && to && from >= to) {
      errors.push({ field: 'toDate', message: 'toDate must not be before fromDate' });
    }
    if (from) out.createdFrom = from.toISOString();
    if (to) out.createdBefore = to.toISOString();
  }

  if (errors.length > 0) {
    throw invalid(errors);
  }
  return out;
};

module.exports = {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  validateOrderId,
  validateUserId,
  parseOrderQuery
};
