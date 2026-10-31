const express = require('express');
const cartController = require('./cart.controller');
const { authenticateOAuthToken } = require('../middlewares/oauth-auth.middleware');
const { requireScope } = require('../middlewares/oauth-scope.middleware');

const router = express.Router();

/**
 * @swagger
 * /api/v1/cart:
 *   get:
 *     tags: [Cart]
 *     summary: Get a customer's active cart
 *     description: >
 *       Administrative lookup of the named customer's ACTIVE cart with items,
 *       server-calculated totals, and the current availability/publication status of each
 *       product. When the customer has no active cart, an empty cart representation
 *       (id null, no items, zero totals) is returned.
 *     security:
 *       - OAuth2: [carts:read]
 *     parameters:
 *       - { in: query, name: userId, required: true, schema: { type: string, format: uuid }, description: The customer whose cart to retrieve }
 *     responses:
 *       200: { description: The customer's cart, content: { application/json: { schema: { $ref: '#/components/schemas/Cart' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Cart]
 *     summary: Update a customer's cart
 *     description: >
 *       Applies absolute quantities per product - a quantity of 1-99 adds the product or
 *       sets its quantity, and 0 removes it. The cart is created automatically when none
 *       exists. Product names and unit prices are snapshotted from the catalog on the
 *       server, totals are recomputed from the item rows, and client-supplied prices or
 *       totals are rejected. Only PUBLISHED, available products can be added.
 *     security:
 *       - OAuth2: [carts:write]
 *     parameters:
 *       - { in: query, name: userId, required: true, schema: { type: string, format: uuid }, description: The customer whose cart to update }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             additionalProperties: false
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   additionalProperties: false
 *                   properties:
 *                     productId: { type: string, format: uuid }
 *                     quantity: { type: integer, minimum: 0, maximum: 99, description: Absolute quantity; 0 removes the item }
 *           examples:
 *             setQuantities:
 *               summary: Add one product and remove another
 *               value:
 *                 items:
 *                   - { productId: 72b91880-c947-4323-a045-67ba0955a133, quantity: 2 }
 *                   - { productId: a89ba248-1709-4894-bdec-63e8f11a145a, quantity: 0 }
 *     responses:
 *       200: { description: Updated cart, content: { application/json: { schema: { $ref: '#/components/schemas/Cart' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { description: The user or a referenced product does not exist, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       422: { description: Product not purchasable or cart limits exceeded, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *   delete:
 *     tags: [Cart]
 *     summary: Delete a customer's active cart
 *     description: >
 *       Hard-deletes the named customer's ACTIVE cart and its items. Completed, abandoned,
 *       and expired carts are historical records and are not affected. Idempotent -
 *       returns 204 even when no active cart exists.
 *     security:
 *       - OAuth2: [carts:delete]
 *     parameters:
 *       - { in: query, name: userId, required: true, schema: { type: string, format: uuid }, description: The customer whose cart to delete }
 *     responses:
 *       204: { description: Cart deleted (or no active cart existed) }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/InsufficientScope' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/', authenticateOAuthToken, requireScope('carts:read'), cartController.getCart);
router.patch('/', authenticateOAuthToken, requireScope('carts:write'), cartController.updateCart);
router.delete('/', authenticateOAuthToken, requireScope('carts:delete'), cartController.deleteCart);

module.exports = router;
