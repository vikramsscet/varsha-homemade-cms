const express = require('express');
const oauthController = require('./oauth.controller');

const router = express.Router();

/**
 * @swagger
 * /api/v1/oauth/token:
 *   post:
 *     tags: [OAuth]
 *     summary: Exchange client credentials for an access token
 *     description: >
 *       OAuth2 client-credentials grant. The client authenticates with client_id and
 *       client_secret sent in the request body; the Authorization header is not read, so
 *       there is no header/body precedence to resolve. The optional scope parameter (space
 *       separated) can only narrow the scopes configured for the client; omitting it grants
 *       every configured scope. In the Swagger UI Authorize dialog, the credentials are
 *       moved from Swagger's Basic header into the body by the request interceptor in
 *       src/config/swagger-ui.js.
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [grant_type, client_id, client_secret]
 *             properties:
 *               grant_type: { type: string, enum: [client_credentials], default: client_credentials, example: client_credentials }
 *               client_id: { type: string, example: cms-admin, description: Value of CMS_OAUTH_CLIENT_ID }
 *               client_secret: { type: string, format: password, example: your-client-secret, description: Value of CMS_OAUTH_CLIENT_SECRET }
 *               scope: { type: string, example: 'products:write categories:write', description: Optional space-separated scopes; defaults to all configured scopes }
 *         application/json:
 *           schema:
 *             type: object
 *             required: [grant_type, client_id, client_secret]
 *             properties:
 *               grant_type: { type: string, enum: [client_credentials], default: client_credentials, example: client_credentials }
 *               client_id: { type: string, example: cms-admin, description: Value of CMS_OAUTH_CLIENT_ID }
 *               client_secret: { type: string, format: password, example: your-client-secret, description: Value of CMS_OAUTH_CLIENT_SECRET }
 *               scope: { type: string, example: 'products:write categories:write', description: Optional space-separated scopes; defaults to all configured scopes }
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
 *         description: Unsupported grant type, or an invalid scope
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string, enum: [unsupported_grant_type, invalid_scope], example: unsupported_grant_type }
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