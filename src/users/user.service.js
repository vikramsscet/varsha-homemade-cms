const prisma = require('../config/database');

const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'];

const createUserError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const validateId = (id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw createUserError(400, 'INVALID_USER_ID', 'User ID must be a valid UUID');
  }
};

// The only approved projection of a user row. google_id (authentication
// provider identifier) and any future security metadata are never exposed.
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  profileImageUrl: true,
  emailVerified: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true
};

const validateName = (field, value) => {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw createUserError(400, 'INVALID_USER', `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw createUserError(400, 'INVALID_USER', `${field} must not be empty`);
  }
  if (trimmed.length > 255) {
    throw createUserError(400, 'INVALID_USER', `${field} must be at most 255 characters`);
  }
  return trimmed;
};

const validateProfileImageUrl = (value) => {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2048) {
    throw createUserError(400, 'INVALID_USER', 'profileImageUrl must be an http(s) URL of at most 2048 characters or null');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw createUserError(400, 'INVALID_USER', 'profileImageUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw createUserError(400, 'INVALID_USER', 'profileImageUrl must use http or https');
  }
  return value;
};

// Administrators may suspend or reactivate accounts, but deletion goes through
// the DELETE endpoint so the retention rules there always apply.
const validateStatus = (value) => {
  if (value !== 'ACTIVE' && value !== 'SUSPENDED') {
    throw createUserError(400, 'INVALID_USER', 'status must be ACTIVE or SUSPENDED');
  }
  return value;
};

// Explicit allowlist: every other field (id, email, emailVerified, googleId,
// timestamps, ...) is protected.
const UPDATABLE_FIELDS = {
  firstName: (value) => validateName('firstName', value),
  lastName: (value) => validateName('lastName', value),
  displayName: (value) => validateName('displayName', value),
  profileImageUrl: validateProfileImageUrl,
  status: validateStatus
};

const getUsers = async ({ page, limit, status } = {}) => {
  const pageNumber = page === undefined ? 1 : Number(page);
  const pageSize = limit === undefined ? 20 : Number(limit);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw createUserError(400, 'INVALID_USER_FILTER', 'page must be an integer greater than or equal to 1');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw createUserError(400, 'INVALID_USER_FILTER', 'limit must be an integer between 1 and 100');
  }
  let where;
  if (status !== undefined) {
    if (!USER_STATUSES.includes(status)) {
      throw createUserError(400, 'INVALID_USER_FILTER', `status must be one of ${USER_STATUSES.join(', ')}`);
    }
    where = { status };
  }

  const [total, data] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (pageNumber - 1) * pageSize,
      take: pageSize
    })
  ]);

  return {
    data,
    pagination: {
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
};

const getUserById = async (id) => {
  validateId(id);

  const user = await prisma.user.findUnique({
    where: { id },
    select: PUBLIC_USER_SELECT
  });
  if (!user) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return user;
};

const updateUser = async (id, input) => {
  validateId(id);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw createUserError(400, 'INVALID_USER', 'Request body must be a JSON object');
  }

  if (Object.prototype.hasOwnProperty.call(input, 'email')) {
    throw createUserError(400, 'EMAIL_UPDATE_NOT_SUPPORTED', 'Email changes require a verification flow and are not supported');
  }

  const data = {};
  for (const [field, value] of Object.entries(input)) {
    const validate = UPDATABLE_FIELDS[field];
    if (!validate) {
      throw createUserError(400, 'INVALID_USER', `Field "${field}" cannot be updated`);
    }
    data[field] = validate(value);
  }

  if (Object.keys(data).length === 0) {
    throw createUserError(400, 'INVALID_USER', 'At least one updatable field is required');
  }

  // Deleted accounts are closed records: they cannot be edited or reactivated
  // through this endpoint. updated_at is maintained by the database trigger.
  const result = await prisma.user.updateMany({
    where: { id, status: { not: 'DELETED' } },
    data
  });
  if (result.count === 0) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });
};

// Soft delete: the users row is retained (carts reference it and non-active
// carts are kept as history), the account is marked DELETED, and any ACTIVE
// cart is abandoned. Repeating the request on an already-deleted account is a
// no-op. The customer-facing service denies sign-in to non-ACTIVE accounts.
const deleteUser = async (id) => {
  validateId(id);

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.cart.updateMany({
      where: { userId: id, status: 'ACTIVE' },
      data: { status: 'ABANDONED' }
    });
    await tx.user.updateMany({
      where: { id, status: { not: 'DELETED' } },
      data: { status: 'DELETED' }
    });
  });
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser
};
