const express = require('express');
const { API_PREFIX } = require('../config/env');
const { getHealth } = require('../controllers/health.controller');
const categoryRoutes = require('../categories/category.routes');
const productRoutes = require('../products/product.routes');

const router = express.Router();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     tags: [Health]
 *     summary: Check API and database health
 *     responses:
 *       200:
 *         description: Healthy service
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 service: { type: string, example: varsha-homemade-cms }
 *                 database: { type: string, example: connected }
 *                 timestamp: { type: string, format: date-time }
 *       503: { description: Database unavailable }
 */
router.get(`${API_PREFIX}/health`, getHealth);
router.use(`${API_PREFIX}/categories`, categoryRoutes);
router.use(`${API_PREFIX}/products`, productRoutes);

module.exports = router;
