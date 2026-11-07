const { createHash } = require('node:crypto');
const { OrderApiError } = require('./order.errors');

// Keyset pagination helpers for ORDER BY created_at DESC, id DESC.
//
// The cursor is opaque (base64url JSON) and carries the last row's createdAt (microsecond
// precision, as text - a JS Date would truncate to milliseconds and break paging), its id, and a
// fingerprint of the filters it was issued under, so it cannot be replayed against other filters.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidCursor = () => new OrderApiError(400, 'INVALID_CURSOR', 'cursor is invalid');

const normalizeLimit = (limit) => {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new OrderApiError(400, 'INVALID_REQUEST', `limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
};

// Stable digest of the active filters (key order and undefined values do not matter).
const filterFingerprint = (filters = {}) => {
  const canonical = Object.keys(filters)
    .sort()
    .filter((key) => filters[key] !== undefined && filters[key] !== null)
    .map((key) => [key, String(filters[key])]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
};

const encodeCursor = ({ createdAt, id }, fingerprint) =>
  Buffer.from(JSON.stringify({ t: createdAt, i: id, f: fingerprint })).toString('base64url');

// Returns { createdAt, id } or throws INVALID_CURSOR.
const decodeCursor = (cursor, fingerprint) => {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512) throw invalidCursor();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || !CREATED_AT_PATTERN.test(parsed.t)
    || !UUID_PATTERN.test(parsed.i)
    || parsed.f !== fingerprint
  ) {
    throw invalidCursor();
  }
  return { createdAt: parsed.t, id: parsed.i.toLowerCase() };
};

// Rows are fetched with limit + 1 so the presence of the extra row says another page exists.
const buildPage = (rows, limit, fingerprint) => {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  // cursorCreatedAt only exists to build the cursor; it is not part of the returned view.
  const items = pageRows.map(({ cursorCreatedAt, ...item }) => item);
  return {
    items,
    pagination: {
      nextCursor: hasMore ? encodeCursor({ createdAt: last.cursorCreatedAt, id: last.id }, fingerprint) : null,
      hasMore
    }
  };
};

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeLimit,
  filterFingerprint,
  encodeCursor,
  decodeCursor,
  buildPage
};
