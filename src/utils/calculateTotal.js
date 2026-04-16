const { firebase } = require("../config");
const CouponService = require("../services/CouponService");
const logger = require("../logger");

const CONFIG_DOC = firebase.db.doc("config/eventConfig");

// Fallback prices if Firestore config is unavailable
const DEFAULT_PRICES = { full: 798, half: 399, social: 479.28 };

async function getTicketPrices() {
  try {
    const snap = await CONFIG_DOC.get();
    if (snap.exists) {
      const prices = snap.data().ticketPrices || {};
      return {
        full: prices.full ?? DEFAULT_PRICES.full,
        half: prices.half ?? DEFAULT_PRICES.half,
        social: prices.social ?? DEFAULT_PRICES.social,
      };
    }
  } catch (err) {
    logger.warn(
      "[calculateTotal] Falha ao ler preços do Firestore, usando defaults:",
      err.message
    );
  }
  return DEFAULT_PRICES;
}

/**
 * Calcula o total da compra usando os preços configurados no Firestore.
 * O cupom é validado contra o Firestore — não mais hardcoded.
 *
 * @param {number} allTickets
 * @param {number} halfTickets
 * @param {number} socialTickets
 * @param {string} coupon — código do cupom (opcional)
 * @returns {Promise<object>}
 */
const calculateTotal = async (
  allTickets,
  halfTickets,
  socialTickets,
  coupon
) => {
  const ticketQuantity = allTickets + halfTickets + socialTickets;
  if (ticketQuantity <= 0) throw new Error("Selecione ao menos 1 ingresso.");

  const prices = await getTicketPrices();

  const valueTicketsAll = allTickets * prices.full;
  const valueTicketsHalf = halfTickets * prices.half;
  const valueTicketsSocial = socialTickets * prices.social;

  let discount = 0;

  if (coupon && coupon.trim()) {
    const result = await CouponService.validateAndCalculate(
      coupon,
      allTickets,
      halfTickets,
      socialTickets
    );
    discount = result.discount;
  }

  const total =
    valueTicketsAll + valueTicketsHalf + valueTicketsSocial - discount;

  return {
    allTickets,
    halfTickets,
    socialTickets,
    ticketQuantity,
    valueTicketsAll: valueTicketsAll.toFixed(2),
    valueTicketsHalf: valueTicketsHalf.toFixed(2),
    valueTicketsSocial: valueTicketsSocial.toFixed(2),
    discount: discount.toFixed(2),
    total: total.toFixed(2),
    totalInCents: Math.round(total * 100),
  };
};

module.exports = { calculateTotal };
