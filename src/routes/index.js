const express = require('express');
const { API_PREFIX } = require('../config/env');
const { getHealth } = require('../controllers/health.controller');
const categoryRoutes = require('../categories/category.routes');
const productRoutes = require('../products/product.routes');

const router = express.Router();

router.get(`${API_PREFIX}/health`, getHealth);
router.use(`${API_PREFIX}/categories`, categoryRoutes);
router.use(`${API_PREFIX}/products`, productRoutes);

module.exports = router;
