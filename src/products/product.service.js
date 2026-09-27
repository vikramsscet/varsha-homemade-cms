const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const storageService = require('../services/storage.service');

const categorySelect = {
  id: true,
  name: true,
  slug: true
};

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const createProductError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const isUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const validateProductId = (id) => {
  if (!isUuid(id)) {
    throw createProductError(400, 'INVALID_PRODUCT_ID', 'Invalid product ID');
  }
};

const validateTitle = (title) => {
  if (typeof title !== 'string' || title.trim() === '') {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product title is required');
  }

  return title.trim();
};

const validateSlug = (slug) => {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product slug is required');
  }

  const normalizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product slug must contain only URL-safe characters');
  }

  return normalizedSlug;
};

const validateDescription = (description) => {
  if (description === null || typeof description !== 'object' || Array.isArray(description)) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product description must be a JSON object');
  }

  return description;
};

const validatePrice = (price) => {
  const priceValue = typeof price === 'number' ? String(price) : price;
  if (typeof priceValue !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(priceValue.trim())) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product price must be a non-negative number with up to 2 decimal places');
  }

  try {
    const decimal = new Prisma.Decimal(priceValue.trim());
    if (decimal.isNegative()) {
      throw new Error('negative price');
    }

    return decimal;
  } catch (error) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product price must be a non-negative number with up to 2 decimal places');
  }
};

const validateCategoryId = (categoryId) => {
  if (!isUuid(categoryId)) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product categoryId must be a valid UUID');
  }

  return categoryId;
};

const validateOptionalString = (value, fieldName) => {
  if (value !== null && typeof value !== 'string') {
    throw createProductError(400, 'INVALID_PRODUCT', `Product ${fieldName} must be a string or null`);
  }

  return value === null ? null : value.trim();
};

const validateCurrency = (currency) => {
  if (typeof currency !== 'string' || !/^[a-z]{3}$/i.test(currency.trim())) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product currency must be a 3-letter code');
  }

  return currency.trim().toUpperCase();
};

const validateStatus = (status) => {
  const validStatuses = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'];
  if (!validStatuses.includes(status)) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product status is invalid');
  }

  return status;
};

const validateBoolean = (value, fieldName) => {
  if (typeof value !== 'boolean') {
    throw createProductError(400, 'INVALID_PRODUCT', `Product ${fieldName} must be a boolean`);
  }

  return value;
};

const validateDisplayOrder = (displayOrder) => {
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product displayOrder must be an integer greater than or equal to 0');
  }

  return displayOrder;
};

const productInclude = {
  category: { select: categorySelect },
  images: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      asset: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          size: true,
          storageKey: true,
          publicUrl: true
        }
      }
    }
  }
};

const buildImageUrl = (asset) => asset?.publicUrl || storageService.getFileUrl({ key: asset?.storageKey });

const serializeProductImageRecord = (productImage) => {
  const asset = productImage.asset;
  const url = buildImageUrl(asset);

  return {
    id: productImage.id,
    productId: productImage.productId,
    asset: {
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      url
    },
    altText: productImage.altText,
    displayOrder: productImage.displayOrder,
    isPrimary: productImage.isPrimary
  };
};

const serializeProductImageSummary = (productImage) => {
  const asset = productImage.asset;

  return {
    id: productImage.id,
    url: buildImageUrl(asset),
    altText: productImage.altText,
    displayOrder: productImage.displayOrder,
    isPrimary: productImage.isPrimary
  };
};

const serializeProduct = (product, includeDescription = true) => {
  const response = {
    id: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    ...(includeDescription ? { description: product.description } : {}),
    price: Number(product.price.toString()),
    currency: product.currency,
    packageSize: product.packageSize,
    status: product.status,
    isFeatured: product.isFeatured,
    isAvailable: product.isAvailable,
    displayOrder: product.displayOrder,
    category: product.category,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    publishedAt: product.publishedAt
  };

  if (product.images) {
    response.images = product.images.map((image) => serializeProductImageSummary(image));
  }

  return response;
};

const handlePrismaError = (error) => {
  if (error.code === 'P2002') {
    throw createProductError(409, 'PRODUCT_SLUG_ALREADY_EXISTS', 'A product with this slug already exists');
  }

  throw error;
};

const validateImageFile = (file) => {
  const maxImageSize = Number(process.env.MAX_IMAGE_SIZE || 5242880);

  if (!file || !file.buffer || !file.mimetype) {
    throw createProductError(400, 'INVALID_IMAGE', 'Only JPEG, PNG and WebP images up to 5 MB are supported');
  }

  if (!allowedMimeTypes.has(file.mimetype)) {
    throw createProductError(400, 'INVALID_IMAGE', 'Only JPEG, PNG and WebP images up to 5 MB are supported');
  }

  if (!Number.isFinite(maxImageSize) || maxImageSize <= 0 || Number(file.size) > maxImageSize) {
    throw createProductError(400, 'INVALID_IMAGE', 'Only JPEG, PNG and WebP images up to 5 MB are supported');
  }

  return file;
};

const sanitizeFileName = (fileName) => {
  const base = (fileName || 'product-image')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120);

  return base || 'product-image';
};

const generateStorageKey = (productId, fileName) => {
  const uniqueId = crypto.randomUUID().split('-')[0];
  const safeFileName = sanitizeFileName(fileName);
  return `products/${productId}/${uniqueId}-${safeFileName}`;
};

const ensureProductExists = async (productId, transaction = prisma) => {
  const product = await transaction.product.findUnique({
    where: { id: productId },
    select: { id: true }
  });

  if (!product) {
    throw createProductError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  return product;
};

const createProduct = async (input = {}) => {
  const categoryId = validateCategoryId(input.categoryId);
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true }
  });

  if (!category) {
    throw createProductError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  }

  const data = {
    title: validateTitle(input.title),
    slug: validateSlug(input.slug),
    description: validateDescription(input.description),
    price: validatePrice(input.price),
    categoryId
  };

  if (input.subtitle !== undefined) data.subtitle = validateOptionalString(input.subtitle, 'subtitle');
  if (input.currency !== undefined) data.currency = validateCurrency(input.currency);
  if (input.packageSize !== undefined) data.packageSize = validateOptionalString(input.packageSize, 'packageSize');
  if (input.status !== undefined) data.status = validateStatus(input.status);
  if (input.isFeatured !== undefined) data.isFeatured = validateBoolean(input.isFeatured, 'isFeatured');
  if (input.isAvailable !== undefined) data.isAvailable = validateBoolean(input.isAvailable, 'isAvailable');
  if (input.displayOrder !== undefined) data.displayOrder = validateDisplayOrder(input.displayOrder);

  try {
    const product = await prisma.product.create({
      data,
      include: productInclude
    });

    return serializeProduct(product);
  } catch (error) {
    handlePrismaError(error);
  }
};

const parsePagination = ({ page, limit }) => {
  const parsedPage = page === undefined ? 1 : Number(page);
  const requestedLimit = limit === undefined ? 20 : Number(limit);

  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Page must be a positive integer');
  }

  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Limit must be a positive integer');
  }

  return {
    page: parsedPage,
    limit: Math.min(requestedLimit, 100)
  };
};

const getProducts = async (pagination = {}) => {
  const { page, limit } = parsePagination(pagination);
  const skip = (page - 1) * limit;

  const [total, products] = await prisma.$transaction([
    prisma.product.count(),
    prisma.product.findMany({
      skip,
      take: limit,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: productInclude
    })
  ]);

  return {
    data: products.map((product) => serializeProduct(product, false)),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  };
};

const getProductById = async (id) => {
  validateProductId(id);

  const product = await prisma.product.findUnique({
    where: { id },
    include: productInclude
  });

  if (!product) {
    throw createProductError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  return serializeProduct(product);
};

const updateProduct = async (id, input = {}) => {
  validateProductId(id);

  const existingProduct = await prisma.product.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!existingProduct) {
    throw createProductError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createProductError(400, 'NO_UPDATE_FIELDS', 'At least one field is required to update the product');
  }

  const immutableFields = ['id', 'createdAt', 'updatedAt', 'publishedAt'];
  if (immutableFields.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    throw createProductError(400, 'INVALID_PRODUCT', 'Product identity and timestamps cannot be updated');
  }

  const data = {};
  if (Object.prototype.hasOwnProperty.call(input, 'title')) data.title = validateTitle(input.title);
  if (Object.prototype.hasOwnProperty.call(input, 'slug')) data.slug = validateSlug(input.slug);
  if (Object.prototype.hasOwnProperty.call(input, 'subtitle')) data.subtitle = validateOptionalString(input.subtitle, 'subtitle');
  if (Object.prototype.hasOwnProperty.call(input, 'description')) data.description = validateDescription(input.description);
  if (Object.prototype.hasOwnProperty.call(input, 'price')) data.price = validatePrice(input.price);
  if (Object.prototype.hasOwnProperty.call(input, 'currency')) data.currency = validateCurrency(input.currency);
  if (Object.prototype.hasOwnProperty.call(input, 'packageSize')) data.packageSize = validateOptionalString(input.packageSize, 'packageSize');
  if (Object.prototype.hasOwnProperty.call(input, 'status')) data.status = validateStatus(input.status);
  if (Object.prototype.hasOwnProperty.call(input, 'isFeatured')) data.isFeatured = validateBoolean(input.isFeatured, 'isFeatured');
  if (Object.prototype.hasOwnProperty.call(input, 'isAvailable')) data.isAvailable = validateBoolean(input.isAvailable, 'isAvailable');
  if (Object.prototype.hasOwnProperty.call(input, 'displayOrder')) data.displayOrder = validateDisplayOrder(input.displayOrder);

  if (Object.prototype.hasOwnProperty.call(input, 'categoryId')) {
    const categoryId = validateCategoryId(input.categoryId);
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true }
    });

    if (!category) {
      throw createProductError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    }

    data.categoryId = categoryId;
  }

  if (Object.keys(data).length === 0) {
    throw createProductError(400, 'NO_UPDATE_FIELDS', 'At least one field is required to update the product');
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data,
      include: productInclude
    });

    return serializeProduct(product);
  } catch (error) {
    if (error.code === 'P2025') {
      throw createProductError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }

    handlePrismaError(error);
  }
};

const uploadProductImage = async (productId, input = {}) => {
  validateProductId(productId);
  const file = validateImageFile(input.file);
  await ensureProductExists(productId);

  const storageKey = generateStorageKey(productId, file.originalname || 'product-image');
  const publicUrl = storageService.getFileUrl({ key: storageKey });

  try {
    await storageService.uploadFile({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimetype
    });
  } catch (error) {
    throw error;
  }

  const assetData = {
    fileName: file.originalname || 'product-image',
    mimeType: file.mimetype,
    size: Number(file.size),
    storageKey,
    publicUrl
  };

  const requestedPrimary = Boolean(input.isPrimary);
  const displayOrder = Number.isInteger(input.displayOrder) ? input.displayOrder : 0;
  const altText = input.altText === undefined || input.altText === null ? null : String(input.altText).trim() || null;

  const result = await prisma.$transaction(async (transaction) => {
    const existingImageCount = await transaction.productImage.count({ where: { productId } });
    const shouldBePrimary = requestedPrimary || existingImageCount === 0;

    if (shouldBePrimary) {
      await transaction.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const asset = await transaction.asset.create({ data: assetData });
    const productImage = await transaction.productImage.create({
      data: {
        productId,
        assetId: asset.id,
        altText,
        displayOrder,
        isPrimary: shouldBePrimary
      },
      include: {
        asset: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            size: true,
            storageKey: true,
            publicUrl: true
          }
        }
      }
    });

    return productImage;
  });

  return serializeProductImageRecord(result);
};

const getProductImages = async (productId) => {
  validateProductId(productId);
  await ensureProductExists(productId);

  const productImages = await prisma.productImage.findMany({
    where: { productId },
    include: {
      asset: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          size: true,
          storageKey: true,
          publicUrl: true
        }
      }
    },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }]
  });

  return {
    data: productImages.map((productImage) => serializeProductImageRecord(productImage))
  };
};

const deleteProductImage = async (productId, imageId) => {
  validateProductId(productId);
  if (!isUuid(imageId)) {
    throw createProductError(400, 'INVALID_PRODUCT_IMAGE_ID', 'Invalid product image ID');
  }

  const productImage = await prisma.productImage.findUnique({
    where: { id: imageId },
    include: { asset: true }
  });

  if (!productImage || productImage.productId !== productId) {
    throw createProductError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Product image not found');
  }

  await storageService.deleteFile({ key: productImage.asset.storageKey });

  await prisma.$transaction(async (transaction) => {
    const currentImage = await transaction.productImage.findUnique({
      where: { id: imageId },
      include: { asset: true }
    });

    if (!currentImage) {
      throw createProductError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Product image not found');
    }

    const wasPrimary = currentImage.isPrimary;

    await transaction.productImage.delete({ where: { id: imageId } });

    if (wasPrimary) {
      const nextPrimary = await transaction.productImage.findFirst({
        where: { productId },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true }
      });

      if (nextPrimary) {
        await transaction.productImage.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true }
        });
      }
    }

    await transaction.asset.delete({ where: { id: currentImage.assetId } });
  });
};

const deleteProduct = async (id) => {
  validateProductId(id);

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: {
        include: { asset: true }
      }
    }
  });

  if (!product) {
    throw createProductError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }

  const assetKeys = product.images.map((image) => image.asset.storageKey).filter(Boolean);
  for (const key of assetKeys) {
    await storageService.deleteFile({ key });
  }

  const assetIds = product.images.map((image) => image.assetId);

  await prisma.$transaction(async (transaction) => {
    await transaction.productImage.deleteMany({ where: { productId: id } });
    if (assetIds.length > 0) {
      await transaction.asset.deleteMany({ where: { id: { in: assetIds } } });
    }
    await transaction.product.delete({ where: { id } });
  });
};

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  uploadProductImage,
  getProductImages,
  deleteProductImage,
  deleteProduct
};
