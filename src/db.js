const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'data', 'shop.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_usd REAL NOT NULL,
    image_url TEXT,
    spec TEXT,
    description TEXT,
    stock INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tran_id TEXT UNIQUE NOT NULL,       -- what we send to PayWay as tran_id
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    shipping_address TEXT NOT NULL,
    payment_method TEXT NOT NULL,        -- 'aba'
    subtotal_usd REAL NOT NULL,
    shipping_usd REAL NOT NULL,
    total_usd REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | cancelled | shipped
    payway_transaction_id TEXT,
    payway_bank_ref TEXT,
    demo_mode INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price_usd REAL NOT NULL,
    qty INTEGER NOT NULL
);
`);

// --- migration: add customer_id to orders if this DB predates accounts ---
const orderCols = db.prepare("PRAGMA table_info(orders)").all();
if (!orderCols.some((c) => c.name === 'customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
    console.log('Migrated: added customer_id to orders table.');
}

// --- seed products (only if table is empty) ---
const countRow = db.prepare('SELECT COUNT(*) AS n FROM products').get();
if (countRow.n === 0) {
    const seed = db.prepare(`
        INSERT INTO products (id, name, price_usd, image_url, spec, description, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const products = [
        ['shoes', 'Running Shoes', 79, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600', 'Mesh Upper / Rubber Sole', 'Comfortable and stylish, built for daily mileage.', 40],
        ['tshirt', 'T-Shirt', 25, 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600', '100% Cotton / Preshrunk', 'Premium quality cotton, cut for everyday wear.', 120],
        ['headphones', 'Headphones', 120, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600', 'Over-Ear / Wireless', 'Crystal clear sound with all-day comfort.', 25],
        ['backpack', 'Canvas Backpack', 64, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600', 'Waxed Canvas / Leather Trim', 'Rugged daily carry that only looks better with wear.', 30],
        ['jacket', 'Wool Field Jacket', 149, 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600', 'Water-Resistant / Wool Blend', 'Built for shifting weather, from trailhead to city.', 15],
        ['bottle', 'Insulated Bottle', 34, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600', '18/8 Steel / 24oz', 'Keeps cold drinks cold and hot drinks hot, all day.', 60],
    ];
    for (const p of products) seed.run(...p);
    console.log(`Seeded ${products.length} products.`);
}

module.exports = db;
