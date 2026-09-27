const express = require('express');
const multer = require('multer');
const productController = require('./product.controller');
const productImageController = require('./product-image.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', productController.createProduct);
router.get('/', productController.getProducts);
router.post('/:productId/images', upload.single('file'), productImageController.uploadProductImage);
router.get('/:productId/images', productImageController.getProductImages);
router.delete('/:productId/images/:imageId', productImageController.deleteProductImage);
router.get('/:id', productController.getProductById);
router.patch('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;
