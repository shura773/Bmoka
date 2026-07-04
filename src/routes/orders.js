const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const payway = require('../payway');

const router = express.Router();

const FLAT_SHIPPING = Number(process.env.FLAT_SHIPPING_USD || 6);

/**
 * POST /api/orders
 * body: {
 *   customer: { name, email, address },
 *   items: [{ product_id, qty }],
 *   payment_method: 'aba'
 * }
 *
 * Prices are NEVER taken from the client — every line item is
 * re-priced from the products table on the server.
 */
router.post('/', async (req, res) => {
    try {
        const { customer, items, payment_method } = req.body || {};

        if (!customer || !customer.name || !customer.email || !customer.address) {
            return res.status(400).json({ error: 'Missing customer name, email, or address.' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }
        if (payment_method !== 'aba') {
            return res.status(400).json({ error: 'payment_method must be "aba".' });
        }

        const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
        let subtotal = 0;
        const resolvedItems = [];

        for (const item of items) {
            const product = getProduct.get(item.product_id);
            if (!product) {
                return res.status(400).json({ error: `Unknown product: ${item.product_id}` });
            }
            const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
            if (qty > product.stock) {
                return res.status(400).json({ error: `Not enough stock for ${product.name}.` });
            }
            subtotal += product.price_usd * qty;
            resolvedItems.push({ product, qty });
        }

        const shipping = FLAT_SHIPPING;
        const total = Number((subtotal + shipping).toFixed(2));
        const tranId = 'MS-' + crypto.randomBytes(6).toString('hex').toUpperCase();

        // If the customer is logged in, link the order to their account.
        // Guest checkout (no account) still works fine — customer_id stays null.
        const customerId = req.session && req.session.type === 'customer' ? req.session.customerId : null;

        const insertOrder = db.prepare(`
            INSERT INTO orders
                (tran_id, customer_id, customer_name, customer_email, shipping_address, payment_method,
                 subtotal_usd, shipping_usd, total_usd, status, demo_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `);
        const orderInfo = insertOrder.run(
            tranId,
            customerId,
            customer.name,
            customer.email,
            customer.address,
            payment_method,
            Number(subtotal.toFixed(2)),
            shipping,
            total,
            payway.DEMO_MODE ? 1 : 0
        );
        const orderId = orderInfo.lastInsertRowid;

        const insertItem = db.prepare(`
            INSERT INTO order_items (order_id, product_id, product_name, unit_price_usd, qty)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const { product, qty } of resolvedItems) {
            insertItem.run(orderId, product.id, product.name, product.price_usd, qty);
        }

        const itemsDescription = resolvedItems.map((i) => `${i.product.name} x${i.qty}`).join(', ');

        const payment = await payway.createPayment({
            tranId,
            amountUsd: total,
            itemsDescription,
            paymentMethod: payment_method,
        });

        res.json({
            order_id: orderId,
            tran_id: tranId,
            subtotal,
            shipping,
            total,
            demo: payment.demo,
            payment: {
                qr_image_url: payment.qrImageUrl,
                qr_string: payment.qrString,
                deeplink: payment.deeplink,
            },
        });
    } catch (err) {
        console.error('Create order failed:', err);
        res.status(500).json({ error: 'Failed to create order.' });
    }
});

/**
 * GET /api/orders/:id
 * Frontend polls this while the customer is looking at the QR screen.
 */
router.get('/:id', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const items = db.prepare('SELECT product_name, unit_price_usd, qty FROM order_items WHERE order_id = ?').all(order.id);

    res.json({ order: { ...order, items } });
});

module.exports = router;
