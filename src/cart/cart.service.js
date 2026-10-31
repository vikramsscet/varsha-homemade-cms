const prisma = require('../config/database');
const pricing = require('./cart.pricing');
const { CART_MAX_ITEM_QUANTITY, CART_MAX_DISTINCT_ITEMS } = require('../config/env');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createCartError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const toItemView = (item, product) => ({
  id: item.id,
  productId: item.productId,
  productName: item.productName,
  productSlug: item.productSlug,
  unitPrice: Number(item.unitPrice),
  quantity: item.quantity,
  totalPrice: Number(item.totalPrice),
  product: product
    ? { status: product.status, isAvailable: product.isAvailable, isPublished: product.status === 'PUBLISHED' }
    : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt
});

const toCartView = (cart, items, productsById) => ({
  id: cart.id,
  status: cart.status,
  currency: cart.currency,
  subtotal: Number(cart.subtotal),
  discountAmount: Number(cart.discountAmount),
  taxAmount: Number(cart.taxAmount),
  totalAmount: Number(cart.totalAmount),
  itemCount: items.reduce((count, item) => count + item.quantity, 0),
  items: items.map((item) => toItemView(item, productsById.get(item.productId))),
  createdAt: cart.createdAt,
  updatedAt: cart.updatedAt
});

// GET /cart must handle "no cart yet" gracefully, so an authenticated user
// without an ACTIVE cart gets a stable empty representation instead of a 404.
const emptyCartView = () => ({
  id: null,
  status: 'ACTIVE',
  currency: 'INR',
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
  itemCount: 0,
  items: [],
  createdAt: null,
  updatedAt: null
});

const loadProductsForItems = async (items, client = prisma) => {
  const productIds = [...new Set(items.map((item) => item.productId))];
  if (productIds.length === 0) return new Map();
  const products = await client.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true, isAvailable: true }
  });
  return new Map(products.map((product) => [product.id, product]));
};

const findActiveCart = (userId, client = prisma) =>
  client.cart.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' }
  });

// Administrative cart operations act on a specific customer's cart, so the
// target user must be named explicitly and must exist.
const resolveUserId = async (userId) => {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw createCartError(400, 'INVALID_USER_ID', 'userId query parameter must be a valid UUID');
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    throw createCartError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return user.id;
};

const getCart = async (userId) => {
  const cart = await findActiveCart(userId);
  if (!cart) return emptyCartView();

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: 'asc' }
  });
  return toCartView(cart, items, await loadProductsForItems(items));
};

// Strict payload validation: only { items: [{ productId, quantity }] } is
// accepted. Prices, names, and totals are never read from the client.
const validateUpdateInput = (input) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw createCartError(400, 'INVALID_CART', 'Request body must be a JSON object');
  }

  const unknownKeys = Object.keys(input).filter((key) => key !== 'items');
  if (unknownKeys.length > 0) {
    throw createCartError(400, 'INVALID_CART', `Unknown field "${unknownKeys[0]}"; only "items" is accepted`);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw createCartError(400, 'INVALID_CART', 'items must be a non-empty array');
  }
  if (input.items.length > CART_MAX_DISTINCT_ITEMS) {
    throw createCartError(400, 'INVALID_CART', `items may contain at most ${CART_MAX_DISTINCT_ITEMS} entries`);
  }

  const seen = new Set();
  return input.items.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw createCartError(400, 'INVALID_CART', 'Each item must be an object with productId and quantity');
    }
    const extraKeys = Object.keys(entry).filter((key) => key !== 'productId' && key !== 'quantity');
    if (extraKeys.length > 0) {
      throw createCartError(400, 'INVALID_CART', `Unknown item field "${extraKeys[0]}"; only productId and quantity are accepted`);
    }
    if (typeof entry.productId !== 'string' || !UUID_PATTERN.test(entry.productId)) {
      throw createCartError(400, 'INVALID_CART', 'productId must be a valid UUID');
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > CART_MAX_ITEM_QUANTITY) {
      throw createCartError(400, 'INVALID_CART', `quantity must be an integer between 0 and ${CART_MAX_ITEM_QUANTITY}`);
    }
    if (seen.has(entry.productId)) {
      throw createCartError(400, 'INVALID_CART', 'items must not repeat the same productId');
    }
    seen.add(entry.productId);
    return { productId: entry.productId, quantity: entry.quantity };
  });
};

// Serialize concurrent updates to the same cart with a row lock.
const lockCart = (cartId, tx) =>
  tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;

const findOrCreateActiveCart = async (userId, tx) => {
  const existing = await findActiveCart(userId, tx);
  if (existing) return existing;
  try {
    return await tx.cart.create({
      data: { userId, status: 'ACTIVE', currency: 'INR' }
    });
  } catch (error) {
    // Unique partial index uq_carts_active_user: lost a race with a concurrent create.
    if (error.code === 'P2002' || error.code === '23505') {
      const cart = await findActiveCart(userId, tx);
      if (cart) return cart;
    }
    throw error;
  }
};

// Applies absolute quantities per product: quantity >= 1 upserts the item with
// a fresh server-side price snapshot, quantity 0 removes it. Runs in a single
// transaction so the item changes and recomputed totals succeed or fail together.
const updateCart = async (userId, input) => {
  const entries = validateUpdateInput(input);

  return prisma.$transaction(async (tx) => {
    const cart = await findOrCreateActiveCart(userId, tx);
    await lockCart(cart.id, tx);

    for (const { productId, quantity } of entries) {
      if (quantity === 0) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
        continue;
      }

      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, title: true, slug: true, price: true, status: true, isAvailable: true }
      });
      if (!product) {
        throw createCartError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} not found`);
      }
      if (product.status !== 'PUBLISHED' || !product.isAvailable) {
        throw createCartError(422, 'PRODUCT_NOT_PURCHASABLE', `Product "${product.title}" is not available for purchase`);
      }

      // Name, slug, and price always come from the catalog, never the client.
      const unitPrice = pricing.normalizeMoney(product.price);
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId } },
        create: {
          cartId: cart.id,
          productId,
          productName: product.title,
          productSlug: product.slug,
          unitPrice,
          quantity,
          totalPrice: pricing.calculateItemTotal(unitPrice, quantity)
        },
        update: {
          productName: product.title,
          productSlug: product.slug,
          unitPrice,
          quantity,
          totalPrice: pricing.calculateItemTotal(unitPrice, quantity)
        }
      });
    }

    const items = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' }
    });
    if (items.length > CART_MAX_DISTINCT_ITEMS) {
      throw createCartError(422, 'CART_ITEM_LIMIT_EXCEEDED', `A cart can hold at most ${CART_MAX_DISTINCT_ITEMS} products`);
    }

    // Totals are always recomputed from the item rows; client amounts are never used.
    const totals = pricing.calculateTotals(items);
    const updated = await tx.cart.update({
      where: { id: cart.id },
      data: totals
    });

    return toCartView(updated, items, await loadProductsForItems(items, tx));
  });
};

// Hard-deletes the ACTIVE cart (items cascade), matching the existing cart
// lifecycle: COMPLETED/ABANDONED/EXPIRED carts are history and are kept.
// Idempotent - deleting when no ACTIVE cart exists is a no-op.
const deleteCart = async (userId) => {
  await prisma.$transaction(async (tx) => {
    const cart = await findActiveCart(userId, tx);
    if (!cart) return;
    await lockCart(cart.id, tx);
    await tx.cart.delete({ where: { id: cart.id } });
  });
};

module.exports = {
  resolveUserId,
  getCart,
  updateCart,
  deleteCart
};
