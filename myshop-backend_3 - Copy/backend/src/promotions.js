const db = require('./db');

/**
 * Finds the best-matching active quantity-discount tier for a given
 * total item count, and computes the discount in dollars from a subtotal.
 *
 * "Best" = the highest min_qty threshold the order actually qualifies
 * for (tiers don't stack — buying 25 items gets you the 20+ tier, not
 * both the 10+ and 20+ tiers added together).
 */
function computeQuantityDiscount(totalQty, subtotal) {
    if (!totalQty || totalQty <= 0 || !subtotal || subtotal <= 0) {
        return { percent: 0, discount_usd: 0, tier: null };
    }

    const tier = db
        .prepare(`
            SELECT * FROM quantity_discounts
            WHERE active = 1 AND min_qty <= ?
            ORDER BY min_qty DESC
            LIMIT 1
        `)
        .get(totalQty);

    if (!tier) {
        return { percent: 0, discount_usd: 0, tier: null };
    }

    const discount = Number((subtotal * (tier.discount_percent / 100)).toFixed(2));
    return { percent: tier.discount_percent, discount_usd: discount, tier };
}

module.exports = { computeQuantityDiscount };
