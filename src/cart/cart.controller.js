const cartService = require('./cart.service');

const getCart = async (req, res, next) => {
  try {
    const userId = await cartService.resolveUserId(req.query.userId);
    const cart = await cartService.getCart(userId);
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

const updateCart = async (req, res, next) => {
  try {
    const userId = await cartService.resolveUserId(req.query.userId);
    const cart = await cartService.updateCart(userId, req.body);
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

const deleteCart = async (req, res, next) => {
  try {
    const userId = await cartService.resolveUserId(req.query.userId);
    await cartService.deleteCart(userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCart,
  updateCart,
  deleteCart
};
