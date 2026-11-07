const express = require('express');
const orderController = require('./order.controller');
const { authenticateOAuthToken } = require('../middlewares/oauth-auth.middleware');
const { requireScope } = require('../middlewares/oauth-scope.middleware');
const { envelopeAuthErrors } = require('./order.auth-errors');

const router = express.Router();
// Mounted separately under /users so it sits next to the account routes.
const userOrderRouter = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     OrderApiError:
 *       type: object
 *       required: [success, error]
 *       properties:
 *         success: { type: boolean, example: false }
 *         error:
 *           type: object
 *           required: [code, message]
 *           properties:
 *             code: { type: string, example: INVALID_REQUEST }
 *             message: { type: string, example: Invalid request }
 *             details: { type: array, items: { type: object, properties: { field: { type: string }, message: { type: string } } } }
 *     RegisteredOrderSummary:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         orderNumber: { type: string, example: VH261106-100001 }
 *         userId: { type: string, format: uuid }
 *         customer:
 *           type: object
 *           properties:
 *             firstName: { type: string, nullable: true }
 *             lastName: { type: string, nullable: true }
 *             email: { type: string, nullable: true }
 *             phone: { type: string, nullable: true }
 *         status: { $ref: '#/components/schemas/OrderStatus' }
 *         currency: { type: string, example: INR }
 *         subtotal: { type: number }
 *         discountAmount: { type: number }
 *         taxAmount: { type: number }
 *         shippingAmount: { type: number }
 *         totalAmount: { type: number }
 *         paymentStatus: { type: string, nullable: true, description: Status of the latest payment attempt }
 *         paymentMethod: { type: string, nullable: true, example: card }
 *         paymentMethodSummary: { type: string, nullable: true, example: Visa •••• 4242 }
 *         createdAt: { type: string, format: date-time }
 *         paidAt: { type: string, format: date-time, nullable: true }
 *     RegisteredOrderDetail:
 *       type: object
 *       description: >
 *         Sections: order, customer, shippingAddress, items and payments. Each payment carries its
 *         own transactions (newest first); there is no separate top-level transaction collection.
 *         Amounts are numbers in major currency units.
 *       properties:
 *         order:
 *           type: object
 *           properties:
 *             id: { type: string, format: uuid }
 *             orderNumber: { type: string, example: VH261106-100001 }
 *             userId: { type: string, format: uuid }
 *             customerType: { type: string, enum: [REGISTERED] }
 *             status: { $ref: '#/components/schemas/OrderStatus' }
 *             currency: { type: string, example: INR }
 *             subtotal: { type: number }
 *             discountAmount: { type: number }
 *             taxAmount: { type: number }
 *             shippingAmount: { type: number }
 *             totalAmount: { type: number }
 *             confirmedAt: { type: string, format: date-time, nullable: true }
 *             paidAt: { type: string, format: date-time, nullable: true }
 *             cancelledAt: { type: string, format: date-time, nullable: true }
 *             paymentExpiresAt: { type: string, format: date-time, nullable: true }
 *             createdAt: { type: string, format: date-time }
 *             updatedAt: { type: string, format: date-time }
 *         customer:
 *           type: object
 *           description: Names from the user account; email and phone are the order-time snapshots
 *           properties:
 *             firstName: { type: string, nullable: true }
 *             lastName: { type: string, nullable: true }
 *             email: { type: string, nullable: true }
 *             phone: { type: string, nullable: true }
 *         shippingAddress: { $ref: '#/components/schemas/OrderShippingAddress' }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             description: Historical snapshot taken when the order was placed
 *             properties:
 *               id: { type: string, format: uuid }
 *               productId: { type: string, format: uuid }
 *               productName: { type: string }
 *               productSlug: { type: string }
 *               unitPrice: { type: number }
 *               quantity: { type: integer }
 *               totalPrice: { type: number }
 *               createdAt: { type: string, format: date-time }
 *         payments: { type: array, description: All attempts, newest attempt first, items: { $ref: '#/components/schemas/RegisteredOrderPayment' } }
 *     RegisteredOrderPayment:
 *       type: object
 *       description: One payment attempt. Never contains card numbers, CVV, PIN, OTP, full UPI handles, gateway credentials or raw gateway responses.
 *       properties:
 *         id: { type: string, format: uuid }
 *         attemptNumber: { type: integer }
 *         gateway: { type: string, example: RAZORPAY }
 *         razorpayOrderId: { type: string }
 *         razorpayPaymentId: { type: string, nullable: true }
 *         status: { $ref: '#/components/schemas/OrderPaymentStatus' }
 *         currency: { type: string, example: INR }
 *         amount: { type: number }
 *         amountRefunded: { type: number }
 *         method: { type: string, nullable: true, example: card }
 *         methodSummary: { type: string, nullable: true, example: Visa •••• 4242 }
 *         methodDetails:
 *           type: object
 *           description: Only the metadata belonging to the payment method is populated
 *           properties:
 *             card:
 *               type: object
 *               nullable: true
 *               properties:
 *                 network: { type: string, nullable: true, example: Visa }
 *                 last4: { type: string, nullable: true, example: '4242' }
 *                 type: { type: string, nullable: true, example: credit }
 *                 issuer: { type: string, nullable: true }
 *             bankCode: { type: string, nullable: true, description: Netbanking }
 *             walletName: { type: string, nullable: true, description: Wallet }
 *             upiHandleMasked: { type: string, nullable: true, example: ab***@okhdfc }
 *         failureCode: { type: string, nullable: true }
 *         failureReason: { type: string, nullable: true }
 *         authorizedAt: { type: string, format: date-time, nullable: true }
 *         capturedAt: { type: string, format: date-time, nullable: true }
 *         failedAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         transactions: { type: array, description: Gateway events for this attempt, newest first, items: { $ref: '#/components/schemas/RegisteredOrderTransaction' } }
 *     RegisteredOrderTransaction:
 *       type: object
 *       description: Append-only ledger entry. The raw gateway_response is intentionally not exposed.
 *       properties:
 *         id: { type: string, format: uuid }
 *         paymentId: { type: string, format: uuid }
 *         type: { type: string, enum: [ATTEMPT, AUTHORIZATION, CAPTURE, FAILURE, REFUND] }
 *         status: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *         amount: { type: number }
 *         currency: { type: string, example: INR }
 *         razorpayPaymentId: { type: string, nullable: true }
 *         razorpayRefundId: { type: string, nullable: true }
 *         source: { type: string, enum: [CLIENT, WEBHOOK, API, SYSTEM] }
 *         webhookEventId: { type: string, format: uuid, nullable: true }
 *         errorCode: { type: string, nullable: true }
 *         errorDescription: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     OrderStatus:
 *       type: string
 *       enum: [PENDING_PAYMENT, PAYMENT_FAILED, PAID, CANCELLED, EXPIRED, PARTIALLY_REFUNDED, REFUNDED]
 *     OrderPaymentStatus:
 *       type: string
 *       enum: [CREATED, PENDING, AUTHORIZED, CAPTURED, FAILED, CANCELLED, EXPIRED, PARTIALLY_REFUNDED, REFUNDED]
 *     OrderShippingAddress:
 *       type: object
 *       description: Historical snapshot taken when the order was placed
 *       properties:
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         phone: { type: string }
 *         country: { type: string, example: IN }
 *         addressLine1: { type: string }
 *         addressLine2: { type: string, nullable: true }
 *         city: { type: string }
 *         state: { type: string }
 *         postalCode: { type: string }
 */

/**
 * @swagger
 * /api/v1/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders of registered users
 *     description: >
 *       Orders placed by registered users across the application, newest first. Guest orders are
 *       never returned. Uses stable keyset (cursor) pagination, so orders created while paging do
 *       not cause duplicates or gaps. The payment fields describe the latest payment attempt and
 *       are null when the order has none.
 *     security:
 *       - OAuth2: [orders:read]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50, default: 10 } }
 *       - { in: query, name: cursor, schema: { type: string }, description: Opaque cursor from a previous response; only valid with the same filters }
 *       - { in: query, name: status, schema: { $ref: '#/components/schemas/OrderStatus' } }
 *       - { in: query, name: paymentStatus, schema: { $ref: '#/components/schemas/OrderPaymentStatus' }, description: Status of the latest payment attempt }
 *       - { in: query, name: search, schema: { type: string, maxLength: 100 }, description: Matches order number prefix, or customer email, phone, first name or last name containing the term }
 *       - { in: query, name: fromDate, schema: { type: string }, description: 'Orders created at or after this ISO 8601 date (YYYY-MM-DD, UTC) or date-time' }
 *       - { in: query, name: toDate, schema: { type: string }, description: 'Orders created up to this ISO 8601 date (whole day, UTC) or before this date-time; must not precede fromDate' }
 *     responses:
 *       200:
 *         description: A page of registered-user orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { $ref: '#/components/schemas/RegisteredOrderSummary' } }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         nextCursor: { type: string, nullable: true, description: Pass back unchanged as cursor }
 *                         hasMore: { type: boolean }
 *                 message: { type: string, example: Orders retrieved successfully }
 *             example:
 *               success: true
 *               data:
 *                 items:
 *                   - id: 0b0a6c34-0f4e-4b9b-9d39-5d3c1f0a1111
 *                     orderNumber: VH261106-100001
 *                     userId: b094b9e4-de81-4fff-864c-d52ce853ff11
 *                     customer: { firstName: Asha, lastName: Rao, email: asha@example.com, phone: '+919999999999' }
 *                     status: PAID
 *                     currency: INR
 *                     subtotal: 500
 *                     discountAmount: 0
 *                     taxAmount: 0
 *                     shippingAmount: 50
 *                     totalAmount: 550
 *                     paymentStatus: CAPTURED
 *                     paymentMethod: card
 *                     paymentMethodSummary: Visa •••• 4242
 *                     createdAt: '2026-11-06T10:00:00.000Z'
 *                     paidAt: '2026-11-06T10:05:00.000Z'
 *                 pagination: { nextCursor: eyJ0IjoiMjAyNi0xMS0wNlQxMDowMDowMC4xMjM0NTZaIiwiaSI6IjBiMGE2YzM0LTBmNGUtNGI5Yi05ZDM5LTVkM2MxZjBhMTExMSIsImYiOiI5ZjJhIn0, hasMore: true }
 *               message: Orders retrieved successfully
 *       400: { description: 'INVALID_REQUEST - invalid limit, status, paymentStatus, search, date range or cursor', content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       401: { description: 'UNAUTHORIZED - missing, invalid or expired token', content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       403: { description: 'FORBIDDEN - token lacks the orders:read scope', content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       500: { description: INTERNAL_ERROR, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 */
router.get('/', envelopeAuthErrors, authenticateOAuthToken, requireScope('orders:read'), orderController.listOrders);

/**
 * @swagger
 * /api/v1/orders/{orderId}:
 *   get:
 *     tags: [Orders]
 *     summary: Get a registered user's order
 *     description: >
 *       Complete historical order: order, customer, shipping address snapshot, item snapshots and
 *       every payment attempt (newest first) with its transactions. Guest orders are never
 *       returned; an unknown order and a guest order produce the same 404.
 *     security:
 *       - OAuth2: [orders:read]
 *     parameters:
 *       - { in: path, name: orderId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The order
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/RegisteredOrderDetail' }
 *                 message: { type: string, example: Order retrieved successfully }
 *             example:
 *               success: true
 *               data:
 *                 order:
 *                   id: 0b0a6c34-0f4e-4b9b-9d39-5d3c1f0a1111
 *                   orderNumber: VH261106-100001
 *                   userId: b094b9e4-de81-4fff-864c-d52ce853ff11
 *                   customerType: REGISTERED
 *                   status: PAID
 *                   currency: INR
 *                   subtotal: 500
 *                   discountAmount: 0
 *                   taxAmount: 0
 *                   shippingAmount: 50
 *                   totalAmount: 550
 *                   confirmedAt: '2026-11-06T10:05:00.000Z'
 *                   paidAt: '2026-11-06T10:05:00.000Z'
 *                   cancelledAt: null
 *                   paymentExpiresAt: '2026-11-07T10:00:00.000Z'
 *                   createdAt: '2026-11-06T10:00:00.000Z'
 *                   updatedAt: '2026-11-06T10:05:00.000Z'
 *                 customer: { firstName: Asha, lastName: Rao, email: asha@example.com, phone: '+919999999999' }
 *                 shippingAddress: { firstName: Asha, lastName: Rao, phone: '+919999999999', country: IN, addressLine1: 1 Main St, addressLine2: null, city: Pune, state: MH, postalCode: '411001' }
 *                 items:
 *                   - { id: 5a1f0c0e-2b57-4a37-8f7e-0d1d0a6c9a10, productId: 7d0c3a52-1c1e-4a65-9a0e-6b2f5c1b7a01, productName: Chakli, productSlug: chakli, unitPrice: 250, quantity: 2, totalPrice: 500, createdAt: '2026-11-06T10:00:00.000Z' }
 *                 payments:
 *                   - id: 9c1b2f1e-6d7a-4b52-9d1c-3a4e5f607182
 *                     attemptNumber: 1
 *                     gateway: RAZORPAY
 *                     razorpayOrderId: order_Nx1
 *                     razorpayPaymentId: pay_Nx1
 *                     status: CAPTURED
 *                     currency: INR
 *                     amount: 550
 *                     amountRefunded: 0
 *                     method: card
 *                     methodSummary: Visa •••• 4242
 *                     methodDetails: { card: { network: Visa, last4: '4242', type: credit, issuer: HDFC }, bankCode: null, walletName: null, upiHandleMasked: null }
 *                     failureCode: null
 *                     failureReason: null
 *                     authorizedAt: '2026-11-06T10:04:00.000Z'
 *                     capturedAt: '2026-11-06T10:05:00.000Z'
 *                     failedAt: null
 *                     createdAt: '2026-11-06T10:01:00.000Z'
 *                     updatedAt: '2026-11-06T10:05:00.000Z'
 *                     transactions:
 *                       - { id: 1e2d3c4b-5a69-4788-9a0b-c1d2e3f40516, paymentId: 9c1b2f1e-6d7a-4b52-9d1c-3a4e5f607182, type: CAPTURE, status: SUCCESS, amount: 550, currency: INR, razorpayPaymentId: pay_Nx1, razorpayRefundId: null, source: WEBHOOK, webhookEventId: null, errorCode: null, errorDescription: null, createdAt: '2026-11-06T10:05:00.000Z' }
 *               message: Order retrieved successfully
 *       400: { description: INVALID_ORDER_ID - orderId is not a UUID, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       401: { description: UNAUTHORIZED, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       403: { description: FORBIDDEN - token lacks orders:read, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       404: { description: ORDER_NOT_FOUND - no such order, or the order belongs to a guest, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       500: { description: INTERNAL_ERROR, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 */
router.get('/:orderId', envelopeAuthErrors, authenticateOAuthToken, requireScope('orders:read'), orderController.getOrder);

/**
 * @swagger
 * /api/v1/users/{userId}/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List a registered user's orders
 *     description: >
 *       Orders belonging to one registered user, newest first, in the same summary shape as
 *       GET /api/v1/orders. Uses keyset (cursor) pagination; a cursor is only valid together with
 *       the filters and user it was issued for. Guest orders are never attributed to a user.
 *       When the user exists but has no orders the response is an empty page with the message
 *       "No orders found".
 *     security:
 *       - OAuth2: [orders:user:read]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50, default: 10 } }
 *       - { in: query, name: cursor, schema: { type: string }, description: Opaque cursor from a previous response }
 *       - { in: query, name: status, schema: { $ref: '#/components/schemas/OrderStatus' } }
 *       - { in: query, name: paymentStatus, schema: { $ref: '#/components/schemas/OrderPaymentStatus' }, description: Status of the latest payment attempt }
 *     responses:
 *       200:
 *         description: A page of the user's orders (possibly empty)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { $ref: '#/components/schemas/RegisteredOrderSummary' } }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         nextCursor: { type: string, nullable: true }
 *                         hasMore: { type: boolean }
 *                 message: { type: string, enum: [User orders retrieved successfully, No orders found] }
 *             examples:
 *               withOrders:
 *                 summary: User with orders
 *                 value:
 *                   success: true
 *                   data:
 *                     items:
 *                       - id: 0b0a6c34-0f4e-4b9b-9d39-5d3c1f0a1111
 *                         orderNumber: VH261106-100001
 *                         userId: b094b9e4-de81-4fff-864c-d52ce853ff11
 *                         customer: { firstName: Asha, lastName: Rao, email: asha@example.com, phone: '+919999999999' }
 *                         status: PAID
 *                         currency: INR
 *                         subtotal: 500
 *                         discountAmount: 0
 *                         taxAmount: 0
 *                         shippingAmount: 50
 *                         totalAmount: 550
 *                         paymentStatus: CAPTURED
 *                         paymentMethod: card
 *                         paymentMethodSummary: Visa •••• 4242
 *                         createdAt: '2026-11-06T10:00:00.000Z'
 *                         paidAt: '2026-11-06T10:05:00.000Z'
 *                     pagination: { nextCursor: eyJ0IjoiMjAyNi0xMS0wNlQxMDowMDowMC4xMjM0NTZaIiwiaSI6IjBiMGE2YzM0LTBmNGUtNGI5Yi05ZDM5LTVkM2MxZjBhMTExMSIsImYiOiI5ZjJhIn0, hasMore: true }
 *                   message: User orders retrieved successfully
 *               noOrders:
 *                 summary: User exists but has no orders
 *                 value:
 *                   success: true
 *                   data: { items: [], pagination: { nextCursor: null, hasMore: false } }
 *                   message: No orders found
 *       400: { description: 'INVALID_USER_ID, or INVALID_REQUEST for an invalid limit, status, paymentStatus or cursor', content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       401: { description: UNAUTHORIZED, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       403: { description: FORBIDDEN - token lacks orders:user:read, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       404: { description: USER_NOT_FOUND, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 *       500: { description: INTERNAL_ERROR, content: { application/json: { schema: { $ref: '#/components/schemas/OrderApiError' } } } }
 */
userOrderRouter.get('/:userId/orders', envelopeAuthErrors, authenticateOAuthToken, requireScope('orders:user:read'), orderController.listUserOrders);

module.exports = { orderRoutes: router, userOrderRoutes: userOrderRouter };
