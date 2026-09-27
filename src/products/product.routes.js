const express = require('express');
const multer = require('multer');
const productController = require('./product.controller');
const productImageController = require('./product-image.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /api/v1/products:
 *   post:
 *     tags: [Products]
 *     summary: Create a product
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
 *       404: { description: Category not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   get:
 *     tags: [Products]
 *     summary: Get products
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/Product' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/', productController.createProduct);
router.get('/', productController.getProducts);

/**
 * @swagger
 * /api/v1/products/{productId}/images:
 *   post:
 *     tags: [Product Images]
 *     summary: Upload a product image
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
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 *   get:
 *     tags: [Product Images]
 *     summary: Get product images
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
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:productId/images', upload.single('file'), productImageController.uploadProductImage);
router.get('/:productId/images', productImageController.getProductImages);

/**
 * @swagger
 * /api/v1/products/{productId}/images/{imageId}:
 *   delete:
 *     tags: [Product Images]
 *     summary: Delete a product image
 *     parameters:
 *       - { in: path, name: productId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: imageId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Image deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.delete('/:productId/images/:imageId', productImageController.deleteProductImage);

/**
 * @swagger
 * /api/v1/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Product, content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Products]
 *     summary: Partially update a product
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
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   delete:
 *     tags: [Products]
 *     summary: Delete a product and its images
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Product deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.get('/:id', productController.getProductById);
router.patch('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;
