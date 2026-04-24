const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { createOrder, getMyOrders, getOrderById, cancelOrder, updateOrderStatus, getAllOrders } = require('../controllers/order.controller');
const { verifyToken, requireAdmin } = require('../middleware/auth.middleware');

router.use(verifyToken);

router.post('/', [
  body('items').isArray({ min: 1 }).withMessage('Items array required'),
  body('shippingAddress.street').notEmpty().withMessage('Street required'),
  body('shippingAddress.city').notEmpty().withMessage('City required'),
  body('shippingAddress.state').notEmpty().withMessage('State required'),
  body('shippingAddress.postalCode').notEmpty().withMessage('Postal code required'),
], createOrder);

router.get('/', getMyOrders);
router.get('/admin/all', requireAdmin, getAllOrders);
router.get('/:id', getOrderById);
router.patch('/:id/cancel', cancelOrder);
router.patch('/:id/status', requireAdmin, [
  body('status').isIn(['pending','confirmed','processing','shipped','delivered','cancelled','refunded']).withMessage('Invalid status'),
], updateOrderStatus);

module.exports = router;
