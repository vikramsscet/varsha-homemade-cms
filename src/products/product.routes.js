const express = require('express');
const multer = require('multer');
const productController = require('./product.controller');
const productImageController = require('./product-image.controller');
const { authenticateOAuthToken } = require('../middlewares/oauth-auth.middleware');
const { requireScope } = require('../middlewares/oauth-scope.middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /api/v1/products:
 *   post:
 *     tags: [Products]
 *     summary: Create a product
 *     security:
 *       - OAuth2: [products:write]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, slug, description, price, categoryId]
 *             properties:
 *               title: { type: string, example: Homemade Chakli }
 *               slug: { type: string, example: homemade-chakli }
 *               subtitle: { type: string }
 *               description: { type: object, additionalProperties: true }
 *               price: { type: number, format: double, example: 250 }
 *               currency: { type: string, example: INR }
 *               packageSize: { type: string, example: 500 g }
 *               categoryId: { type: string, format: uuid }
 *               status: { $ref: '#/components/schemas/ProductStatus' }
 *               isFeatured: { type: boolean }
 *               isAvailable: { type: boolean }
 *               displayOrder: { type: integer, minimum: 0 }
 *     responses:
 *       201: { description: Product created, content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { description: Category not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   get:
 *     tags: [Products]
 *     summary: Get products
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: isAvailable, schema: { type: boolean, description: 'Filter products by availability' } }
 *       - { in: query, name: isPublished, schema: { type: boolean, description: 'Filter products by published status (status = PUBLISHED)' } }
 *       - { in: query, name: isFeatured, schema: { type: boolean, description: 'Filter products by featured status' } }
 *       - { in: query, name: onlyImages, schema: { type: boolean, default: false, description: 'Return only id, title, subtitle, and images' } }
 *     responses:
 *       200:
 *         description: Paginated products, or gallery fields when onlyImages=true
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     oneOf:
 *                       - { $ref: '#/components/schemas/Product' }
 *                       - { $ref: '#/components/schemas/GalleryProduct' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/', authenticateOAuthToken, requireScope('products:write'), productController.createProduct);
router.get('/', productController.getProducts);

/**
 * @swagger
 * /api/v1/products/{productId}/images:
 *   post:
 *     tags: [Product Images]
 *     summary: Upload a product image
 *     security:
 *       - OAuth2: [products:write]
 *     parameters:
 *       - { in: path, name: productId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary, description: JPEG, PNG, or WebP image up to 5 MB }
 *               altText: { type: string }
 *               isPrimary: { type: boolean }
 *               displayOrder: { type: integer, minimum: 0 }
 *     responses:
 *       201: { description: Image uploaded, content: { application/json: { schema: { $ref: '#/components/schemas/ProductImage' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 *   get:
 *     tags: [Product Images]
 *     summary: Get product images
 *     security:
 *       - OAuth2: [products:read]
 *     parameters:
 *       - { in: path, name: productId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Product images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/ProductImage' } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
	'/:productId/images',
	authenticateOAuthToken,
	requireScope('products:write'),
	upload.single('file'),
	productImageController.uploadProductImage
);
router.get(
	'/:productId/images',
	productImageController.getProductImages
);

/**
 * @swagger
 * /api/v1/products/{productId}/images/{imageId}:
 *   delete:
 *     tags: [Product Images]
 *     summary: Delete a product image
 *     security:
 *       - OAuth2: [products:delete]
 *     parameters:
 *       - { in: path, name: productId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: imageId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Image deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.delete(
	'/:productId/images/:imageId',
	authenticateOAuthToken,
	requireScope('products:delete'),
	productImageController.deleteProductImage
);

/**
 * @swagger
 * /api/v1/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product
 *     security:
 *       - OAuth2: [products:read]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Product, content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Products]
 *     summary: Partially update a product
 *     security:
 *       - OAuth2: [products:write]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               slug: { type: string }
 *               subtitle: { type: string, nullable: true }
 *               description: { type: object, additionalProperties: true }
 *               price: { type: number, format: double }
 *               currency: { type: string }
 *               packageSize: { type: string, nullable: true }
 *               categoryId: { type: string, format: uuid }
 *               status: { $ref: '#/components/schemas/ProductStatus' }
 *               isFeatured: { type: boolean }
 *               isAvailable: { type: boolean }
 *               displayOrder: { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: Product updated, content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   delete:
 *     tags: [Products]
 *     summary: Delete a product and its images
 *     security:
 *       - OAuth2: [products:delete]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Product deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.get('/:id', productController.getProductById);
router.patch('/:id', authenticateOAuthToken, requireScope('products:write'), productController.updateProduct);
router.delete('/:id', authenticateOAuthToken, requireScope('products:delete'), productController.deleteProduct);

module.exports = router;
