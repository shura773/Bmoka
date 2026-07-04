const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../auth');
const session = require('../session');

const router = express.Router();

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/signup', (req, res) => {
    const { name, email, password } = req.body || {};

    if (!name || !isValidEmail(email) || !password || password.length < 6) {
        return res.status(400).json({
            error: 'Please provide a name, a valid email, and a password of at least 6 characters.',
        });
    }

    const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email.toLowerCase());
    if (existing) {
        return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = hashPassword(password);
    const result = db
        .prepare('INSERT INTO customers (name, email, password_hash) VALUES (?, ?, ?)')
        .run(name, email.toLowerCase(), passwordHash);

    const token = session.createSession({ type: 'customer', customerId: result.lastInsertRowid });
    session.setSessionCookie(res, token);

    res.json({ id: result.lastInsertRowid, name, email: email.toLowerCase() });
});

router.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || !password) {
        return res.status(400).json({ error: 'Please provide email and password.' });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(email.toLowerCase());
    if (!customer || !verifyPassword(password, customer.password_hash)) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = session.createSession({ type: 'customer', customerId: customer.id });
    session.setSessionCookie(res, token);

    res.json({ id: customer.id, name: customer.name, email: customer.email });
});

router.post('/logout', (req, res) => {
    if (req.sessionToken) session.destroySession(req.sessionToken);
    session.clearSessionCookie(res);
    res.json({ ok: true });
});

router.get('/me', (req, res) => {
    if (!req.session || req.session.type !== 'customer') {
        return res.json({ loggedIn: false });
    }
    const customer = db.prepare('SELECT id, name, email FROM customers WHERE id = ?').get(req.session.customerId);
    if (!customer) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, customer });
});

/**
 * GET /api/auth/my-orders — order history for the logged-in customer.
 */
router.get('/my-orders', session.requireCustomer, (req, res) => {
    const orders = db
        .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
        .all(req.session.customerId);

    const itemsStmt = db.prepare('SELECT product_name, unit_price_usd, qty FROM order_items WHERE order_id = ?');
    const withItems = orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) }));

    res.json({ orders: withItems });
});

module.exports = router;
