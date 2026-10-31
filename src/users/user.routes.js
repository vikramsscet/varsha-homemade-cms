const express = require('express');
const userController = require('./user.controller');
const { authenticateOAuthToken } = require('../middlewares/oauth-auth.middleware');
const { requireScope } = require('../middlewares/oauth-scope.middleware');

const router = express.Router();

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 *     description: Administrative listing of customer accounts, newest first.
 *     security:
 *       - OAuth2: [users:read]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, SUSPENDED, DELETED] } }
 *     responses:
 *       200:
 *         description: Paginated users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/UserProfile' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 */
router.get('/', authenticateOAuthToken, requireScope('users:read'), userController.getUsers);

/**
 * @swagger
 * /api/v1/users/{userId}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user
 *     security:
 *       - OAuth2: [users:read]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: User, content: { application/json: { schema: { $ref: '#/components/schemas/UserProfile' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Users]
 *     summary: Update a user
 *     description: >
 *       Partial update of allowlisted fields only (firstName, lastName, displayName,
 *       profileImageUrl, status ACTIVE|SUSPENDED). Protected fields (id, email,
 *       emailVerified, googleId, timestamps) are rejected with 400, and deletion is only
 *       possible through the DELETE endpoint so retention rules always apply. Deleted
 *       accounts are closed records and cannot be edited.
 *     security:
 *       - OAuth2: [users:write]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             additionalProperties: false
 *             properties:
 *               firstName: { type: string, maxLength: 255, nullable: true }
 *               lastName: { type: string, maxLength: 255, nullable: true }
 *               displayName: { type: string, maxLength: 255, nullable: true }
 *               profileImageUrl: { type: string, format: uri, maxLength: 2048, nullable: true }
 *               status: { type: string, enum: [ACTIVE, SUSPENDED] }
 *     responses:
 *       200: { description: Updated user, content: { application/json: { schema: { $ref: '#/components/schemas/UserProfile' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user account
 *     description: >
 *       Soft-deletes the account (status becomes DELETED) and abandons any active cart.
 *       The user row and historical carts are retained as business records. Repeating the
 *       request on an already-deleted account returns 204. The customer-facing service
 *       refuses sign-in and token use for non-ACTIVE accounts.
 *     security:
 *       - OAuth2: [users:delete]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Account deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:userId', authenticateOAuthToken, requireScope('users:read'), userController.getUserById);
router.patch('/:userId', authenticateOAuthToken, requireScope('users:write'), userController.updateUser);
router.delete('/:userId', authenticateOAuthToken, requireScope('users:delete'), userController.deleteUser);

module.exports = router;
