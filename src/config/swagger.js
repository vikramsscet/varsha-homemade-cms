const swaggerJSDoc = require('swagger-jsdoc');
const { APP_URL } = require('./env');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Varsha Homemade CMS API',
      version: '1.0.0',
      description: 'REST API for Varsha Homemade Product Catalogue and CMS'
    },
    servers: [{ url: APP_URL }],
    tags: [
      { name: 'Categories' },
      { name: 'Products' },
      { name: 'Product Images' },
      { name: 'Health' }
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          required: ['statusCode', 'message'],
          properties: {
            statusCode: { type: 'integer', example: 400 },
            code: { type: 'string', example: 'INVALID_PRODUCT' },
            message: { type: 'string', example: 'Product title is required' }
          }
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Snacks' },
            slug: { type: 'string', example: 'snacks' },
            description: { type: 'string', nullable: true },
            displayOrder: { type: 'integer', example: 0 },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        ProductStatus: {
          type: 'string',
          enum: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']
        },
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            fileName: { type: 'string', example: 'chakli.jpg' },
            mimeType: { type: 'string', example: 'image/jpeg' },
            size: { type: 'integer', example: 245678 },
            storageKey: { type: 'string', example: 'products/PRODUCT_UUID/abc123-chakli.jpg' },
            publicUrl: { type: 'string', format: 'uri', nullable: true },
            width: { type: 'integer', nullable: true },
            height: { type: 'integer', nullable: true },
            altText: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        ProductImage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            asset: { $ref: '#/components/schemas/Asset' },
            altText: { type: 'string', nullable: true },
            displayOrder: { type: 'integer', example: 1 },
            isPrimary: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        ProductImageSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri', nullable: true },
            altText: { type: 'string', nullable: true },
            displayOrder: { type: 'integer' },
            isPrimary: { type: 'boolean' }
          }
        },
        GalleryImage: {
          allOf: [
            { $ref: '#/components/schemas/ProductImageSummary' },
            {
              type: 'object',
              required: ['tall', 'wide'],
              properties: {
                tall: { type: 'boolean' },
                wide: { type: 'boolean' }
              }
            }
          ]
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            subtitle: { type: 'string', nullable: true },
            description: { type: 'object', additionalProperties: true },
            price: { type: 'number', format: 'double' },
            currency: { type: 'string', example: 'INR' },
            packageSize: { type: 'string', nullable: true },
            status: { $ref: '#/components/schemas/ProductStatus' },
            isFeatured: { type: 'boolean' },
            isAvailable: { type: 'boolean' },
            displayOrder: { type: 'integer' },
            category: { $ref: '#/components/schemas/Category' },
            images: { type: 'array', items: { $ref: '#/components/schemas/ProductImageSummary' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            publishedAt: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        GalleryProduct: {
          type: 'object',
          required: ['id', 'title', 'images'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            subtitle: { type: 'string', nullable: true },
            images: { type: 'array', items: { $ref: '#/components/schemas/GalleryImage' } }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 0 },
            totalPages: { type: 'integer', example: 0 }
          }
        }
      },
      responses: {
        BadRequest: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: 'Resource not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Conflict: { description: 'Conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ServerError: { description: 'Internal server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
      }
    }
  },
  apis: ['src/**/*.js']
};

module.exports = swaggerJSDoc(options);
