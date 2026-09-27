const express = require('express');
const categoryController = require('./category.controller');

const router = express.Router();

/**
 * @swagger
 * /api/v1/categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a category
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name: { type: string, example: Snacks }
 *               slug: { type: string, example: snacks }
 *               description: { type: string, nullable: true }
 *               displayOrder: { type: integer, minimum: 0 }
 *               isActive: { type: boolean }
 *     responses:
 *       201: { description: Category created, content: { application/json: { schema: { $ref: '#/components/schemas/Category' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   get:
 *     tags: [Categories]
 *     summary: Get categories
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/Category' } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/', categoryController.createCategory);
router.get('/', categoryController.getCategories);

/**
 * @swagger
 * /api/v1/categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a category
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Category, content: { application/json: { schema: { $ref: '#/components/schemas/Category' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Categories]
 *     summary: Partially update a category
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               slug: { type: string }
 *               description: { type: string, nullable: true }
 *               displayOrder: { type: integer, minimum: 0 }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Category updated, content: { application/json: { schema: { $ref: '#/components/schemas/Category' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Category deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', categoryController.getCategoryById);
router.patch('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);

module.exports = router;
