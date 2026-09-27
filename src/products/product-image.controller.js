const productService = require('./product.service');

const parseBoolean = (value) => value === true || value === 'true';

const parseDisplayOrder = (value) => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
};

const uploadProductImage = async (req, res, next) => {
  try {
    const image = await productService.uploadProductImage(req.params.productId, {
      file: req.file,
      altText: req.body.altText,
      isPrimary: parseBoolean(req.body.isPrimary),
      displayOrder: parseDisplayOrder(req.body.displayOrder)
    });

    res.status(201).json(image);
  } catch (error) {
    next(error);
  }
};

const getProductImages = async (req, res, next) => {
  try {
    const result = await productService.getProductImages(req.params.productId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const deleteProductImage = async (req, res, next) => {
  try {
    await productService.deleteProductImage(req.params.productId, req.params.imageId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadProductImage,
  getProductImages,
  deleteProductImage
};
