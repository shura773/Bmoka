const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const session = require('../session');

const router = express.Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function timingSafeStringEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

router.post('/login', (req, res) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        return res.status(500).json({
            error: 'Admin login is not configured yet. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.',
        });
    }

    const { username, password } = req.body || {};
    const usernameOk = username && timingSafeStringEqual(username, ADMIN_USERNAME);
    const passwordOk = password && timingSafeStringEqual(password, ADMIN_PASSWORD);

    if (!usernameOk || !passwordOk) {
        return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    const token = session.createSession({ type: 'admin' });
    session.setSessionCookie(res, token);
    res.json({ ok: true });
});

router.post('/logout', (req, res) => {
    if (req.sessionToken) session.destroySession(req.sessionToken);
    session.clearSessionCookie(res);
    res.json({ ok: true });
});

router.get('/me', (req, res) => {
    res.json({ loggedIn: !!(req.session && req.session.type === 'admin') });
});

// everything below this line requires an admin session
router.use(session.requireAdmin);

router.get('/orders', (req, res) => {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const itemsStmt = db.prepare('SELECT product_name, unit_price_usd, qty FROM order_items WHERE order_id = ?');
    const withItems = orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) }));
    res.json({ orders: withItems });
});

router.put('/orders/:id/status', (req, res) => {
    const { status } = req.body || {};
    const allowed = ['pending', 'paid', 'shipped', 'cancelled', 'failed'];
    if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    res.json({ ok: true });
});

router.get('/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products').all();
    res.json({ products });
});

router.put('/products/:id', (req, res) => {
    const { price_usd, stock } = req.body || {};
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    const newPrice = price_usd !== undefined ? Number(price_usd) : product.price_usd;
    const newStock = stock !== undefined ? Math.max(0, Math.floor(Number(stock))) : product.stock;

    if (Number.isNaN(newPrice) || newPrice < 0) {
        return res.status(400).json({ error: 'price_usd must be a non-negative number.' });
    }

    db.prepare('UPDATE products SET price_usd = ?, stock = ? WHERE id = ?').run(newPrice, newStock, product.id);
    res.json({ ok: true });
});

// ---------------------------------------------------------------------
// CSV export — opens directly in Excel/Google Sheets, no extra software
// or database driver needed. This is the "connect with Excel" feature.
// ---------------------------------------------------------------------
function toCsvValue(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function rowsToCsv(headers, rows) {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => toCsvValue(row[h])).join(','));
    }
    return lines.join('\r\n');
}

router.get('/export/orders.csv', (req, res) => {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const headers = [
        'id', 'tran_id', 'customer_name', 'customer_email', 'shipping_address',
        'payment_method', 'subtotal_usd', 'shipping_usd', 'total_usd', 'status',
        'demo_mode', 'created_at', 'paid_at',
    ];
    const csv = rowsToCsv(headers, orders);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send(csv);
});

router.get('/export/products.csv', (req, res) => {
    const products = db.prepare('SELECT * FROM products').all();
    const headers = ['id', 'name', 'price_usd', 'stock', 'spec', 'description', 'image_url'];
    const csv = rowsToCsv(headers, products);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send(csv);
});

module.exports = router;
