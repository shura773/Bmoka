const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
    const products = db.prepare('SELECT id, name, price_usd, image_url, spec, description, stock FROM products').all();
    res.json({ products });
});

module.exports = router;
