const express = require('express');
const oauthController = require('./oauth.controller');

const router = express.Router();

/**
 * @swagger
 * /oauth/token:
 *   post:
 *     tags: [OAuth]
 *     summary: Exchange client credentials for an access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [grant_type, client_id, client_secret]
 *             properties:
 *               grant_type: { type: string, enum: [client_credentials] }
 *               client_id: { type: string }
 *               client_secret: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [access_token, token_type, expires_in]
 *               properties:
 *                 access_token: { type: string }
 *                 token_type: { type: string, example: Bearer }
 *                 expires_in: { type: integer, example: 900 }
 *       400:
 *         description: Unsupported grant type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string, example: unsupported_grant_type }
 *                 error_description: { type: string, example: Only client_credentials grant type is supported }
 *       401:
 *         description: Invalid client credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string, example: invalid_client }
 *                 error_description: { type: string, example: Invalid client credentials }
 */
router.post('/token', oauthController.issueToken);

module.exports = router;