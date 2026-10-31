// Cart money maths, mirrored from the user-and-cart-service so both services
// produce identical NUMERIC(12,2) values. Amounts are handled as integer minor
// units (paise) to avoid floating point drift and returned as 2-decimal strings.

const toMinor = (amount) => Math.round(Number(amount) * 100);
const toMoney = (minor) => (minor / 100).toFixed(2);

const calculateItemTotal = (unitPrice, quantity) => toMoney(toMinor(unitPrice) * quantity);

// subtotal = sum(item totals); total = subtotal - discount + tax (never below zero).
// discount/tax are server-owned (0 until promotion/tax engines exist) - never read from clients.
const calculateTotals = (items, discountAmount = 0, taxAmount = 0) => {
  const subtotal = items.reduce((sum, item) => sum + toMinor(item.unitPrice) * item.quantity, 0);
  const discount = Math.min(toMinor(discountAmount), subtotal);
  const total = Math.max(subtotal - discount + toMinor(taxAmount), 0);
  return {
    subtotal: toMoney(subtotal),
    discountAmount: toMoney(discount),
    taxAmount: toMoney(toMinor(taxAmount)),
    totalAmount: toMoney(total)
  };
};

const normalizeMoney = (amount) => toMoney(toMinor(amount));

module.exports = { calculateItemTotal, calculateTotals, normalizeMoney };
