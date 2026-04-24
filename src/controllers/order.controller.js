const axios = require('axios');
const Order = require('../models/order.model');
const logger = require('../config/logger');

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:4002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4006';

// POST /api/orders
const createOrder = async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, notes } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    // Validate products and stock via Product Service
    const productIds = items.map((i) => i.productId);
    let productMap = {};
    try {
      const { data } = await axios.post(`${PRODUCT_SERVICE_URL}/api/products/bulk`, { ids: productIds });
      productMap = data.data.products.reduce((acc, p) => { acc[p._id] = p; return acc; }, {});
    } catch (err) {
      logger.warn(`Could not validate products from product-service: ${err.message}`);
      return res.status(502).json({ success: false, message: 'Product service unavailable' });
    }

    // Build enriched items & verify stock
    const enrichedItems = [];
    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) return res.status(400).json({ success: false, message: `Product ${item.productId} not found` });
      if (product.stock < item.quantity) {
        return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}` });
      }
      enrichedItems.push({
        productId: item.productId,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        imageUrl: product.imageUrl || '',
      });
    }

    const totalAmount = enrichedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await Order.create({
      userId: req.user.id,
      items: enrichedItems,
      totalAmount,
      shippingAddress,
      paymentMethod: paymentMethod || 'cod',
      notes: notes || '',
    });

    // Decrement stock for each product
    await Promise.allSettled(
      enrichedItems.map((item) =>
        axios.patch(`${PRODUCT_SERVICE_URL}/api/products/${item.productId}/stock`, {
          quantity: item.quantity,
          operation: 'decrement',
        })
      )
    );

    // Send notification (fire-and-forget)
    axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications/send`, {
      to: req.user.email,
      type: 'order_confirmation',
      subject: `Order Confirmed - #${order._id}`,
      payload: { orderId: order._id, totalAmount: order.totalAmount, items: enrichedItems },
    }).catch((e) => logger.warn(`Notification failed: ${e.message}`));

    logger.info(`Order created: ${order._id} by user ${req.user.id}`);
    res.status(201).json({ success: true, message: 'Order placed successfully', data: { order } });
  } catch (err) {
    logger.error(`Create order error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
};

// GET /api/orders - user's own orders
const getMyOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const filter = { userId: req.user.id };
    if (status) filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: { orders, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } },
    });
  } catch (err) {
    logger.error(`Get orders error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

// GET /api/orders/:id
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.status(200).json({ success: true, data: { order } });
  } catch (err) {
    logger.error(`Get order by ID error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
};

// PATCH /api/orders/:id/cancel
const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel order in ${order.status} status` });
    }
    order.status = 'cancelled';
    await order.save();

    // Re-increment stock
    await Promise.allSettled(
      order.items.map((item) =>
        axios.patch(`${PRODUCT_SERVICE_URL}/api/products/${item.productId}/stock`, {
          quantity: item.quantity,
          operation: 'increment',
        })
      )
    );

    res.status(200).json({ success: true, message: 'Order cancelled', data: { order } });
  } catch (err) {
    logger.error(`Cancel order error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to cancel order' });
  }
};

// PATCH /api/orders/:id/status - Admin
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.status(200).json({ success: true, message: 'Order status updated', data: { order } });
  } catch (err) {
    logger.error(`Update order status error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};

// GET /api/orders/admin/all - Admin
const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: { orders, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } },
    });
  } catch (err) {
    logger.error(`Admin get all orders error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

module.exports = { createOrder, getMyOrders, getOrderById, cancelOrder, updateOrderStatus, getAllOrders };
