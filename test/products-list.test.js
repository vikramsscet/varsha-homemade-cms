const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const prisma = require('../src/config/database');
const productService = require('../src/products/product.service');

const products = [
  {
    id: 'product-1',
    slug: 'first-product',
    title: 'First product',
    subtitle: null,
    price: { toString: () => '10.00' },
    currency: 'INR',
    packageSize: null,
    status: 'PUBLISHED',
    isFeatured: false,
    isAvailable: true,
    displayOrder: 0,
    category: { id: 'category-1', name: 'Snacks', slug: 'snacks' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    images: [
      {
        id: 'image-1',
        productId: 'product-1',
        altText: 'First image',
        displayOrder: 1,
        isPrimary: true,
        asset: {
          id: 'asset-1',
          fileName: 'first.jpg',
          mimeType: 'image/jpeg',
          size: 100,
          storageKey: 'products/first.jpg',
          publicUrl: 'https://example.com/first.jpg'
        }
      },
      {
        id: 'image-2',
        productId: 'product-1',
        altText: 'Second image',
        displayOrder: 2,
        isPrimary: false,
        asset: {
          id: 'asset-2',
          fileName: 'second.jpg',
          mimeType: 'image/jpeg',
          size: 120,
          storageKey: 'products/second.jpg',
          publicUrl: 'https://example.com/second.jpg'
        }
      },
      {
        id: 'image-3',
        productId: 'product-1',
        altText: 'Third image',
        displayOrder: 3,
        isPrimary: false,
        asset: {
          id: 'asset-3',
          fileName: 'third.jpg',
          mimeType: 'image/jpeg',
          size: 130,
          storageKey: 'products/third.jpg',
          publicUrl: 'https://example.com/third.jpg'
        }
      }
    ]
  }
];

const originalCount = prisma.product.count;
const originalFindMany = prisma.product.findMany;
const originalTransaction = prisma.$transaction;
let countArguments;
let findManyArguments;

beforeEach(() => {
  countArguments = undefined;
  findManyArguments = undefined;
  prisma.product.count = async (args) => {
    countArguments = args;
    return 4;
  };
  prisma.product.findMany = async (args) => {
    findManyArguments = args;
    return products;
  };
  prisma.$transaction = async (queries) => Promise.all(queries);
});

afterEach(() => {
  prisma.product.count = originalCount;
  prisma.product.findMany = originalFindMany;
  prisma.$transaction = originalTransaction;
});

test('omitting onlyImages preserves the existing product response', async () => {
  const result = await productService.getProducts({});

  assert.ok(Object.hasOwn(result.data[0], 'slug'));
  assert.ok(Object.hasOwn(result.data[0], 'price'));
  assert.ok(Object.hasOwn(result.data[0], 'category'));
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.limit, 20);
});

test('onlyImages=false preserves the existing product response', async () => {
  const omitted = await productService.getProducts({});
  const result = await productService.getProducts({ onlyImages: 'false' });

  assert.deepEqual(result, omitted);
  assert.ok(Object.hasOwn(result.data[0], 'slug'));
  assert.ok(Object.hasOwn(result.data[0], 'price'));
  for (const image of result.data[0].images) {
    assert.equal(Object.hasOwn(image, 'tall'), false);
    assert.equal(Object.hasOwn(image, 'wide'), false);
  }
});

test('onlyImages=true returns only gallery fields and image summaries', async () => {
  const originalRandom = Math.random;
  const randomValues = [0.1, 0.5, 0.9];
  let randomCallCount = 0;
  Math.random = () => randomValues[randomCallCount++];

  let result;
  try {
    result = await productService.getProducts({ onlyImages: 'true' });
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(Object.keys(result.data[0]), ['id', 'title', 'subtitle', 'images']);
  assert.deepEqual(result.data[0].images[0], {
    id: 'image-1',
    url: 'https://example.com/first.jpg',
    altText: 'First image',
    displayOrder: 1,
    isPrimary: true,
    tall: true,
    wide: false
  });
  assert.deepEqual(result.data[0].images[1], {
    id: 'image-2',
    url: 'https://example.com/second.jpg',
    altText: 'Second image',
    displayOrder: 2,
    isPrimary: false,
    tall: false,
    wide: true
  });
  assert.deepEqual(result.data[0].images[2], {
    id: 'image-3',
    url: 'https://example.com/third.jpg',
    altText: 'Third image',
    displayOrder: 3,
    isPrimary: false,
    tall: false,
    wide: false
  });
  assert.equal(randomCallCount, 3);
  for (const image of result.data[0].images) {
    assert.equal(typeof image.tall, 'boolean');
    assert.equal(typeof image.wide, 'boolean');
    assert.equal(image.tall && image.wide, false);
  }
  assert.deepEqual(result.data[0].images.map(({ displayOrder }) => displayOrder), [1, 2, 3]);
  assert.deepEqual(findManyArguments.include.images.orderBy, [
    { displayOrder: 'asc' },
    { createdAt: 'asc' }
  ]);
});

test('onlyImages works with availability and publication filters', async () => {
  const result = await productService.getProducts({
    onlyImages: 'true',
    isAvailable: 'true',
    isPublished: 'true'
  });

  assert.deepEqual(countArguments.where, { isAvailable: true, status: 'PUBLISHED' });
  assert.deepEqual(findManyArguments.where, { isAvailable: true, status: 'PUBLISHED' });
  assert.deepEqual(Object.keys(result.data[0]), ['id', 'title', 'subtitle', 'images']);
});

test('onlyImages works with the availability filter alone', async () => {
  await productService.getProducts({ onlyImages: 'true', isAvailable: 'true' });

  assert.deepEqual(findManyArguments.where, { isAvailable: true });
});

test('onlyImages works with the publication filter alone', async () => {
  await productService.getProducts({ onlyImages: 'true', isPublished: 'true' });

  assert.deepEqual(findManyArguments.where, { status: 'PUBLISHED' });
});

test('onlyImages preserves pagination totals and query offsets', async () => {
  const result = await productService.getProducts({ onlyImages: 'true', page: '2', limit: '2' });

  assert.equal(findManyArguments.skip, 2);
  assert.equal(findManyArguments.take, 2);
  assert.deepEqual(result.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 });
});