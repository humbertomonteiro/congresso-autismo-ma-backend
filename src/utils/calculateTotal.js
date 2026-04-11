const config = require('../config');
const CouponService = require('../services/CouponService');

const ALL_TICKET_VALUE = config.valueTickets.allTicket;
const HALF_TICKET_VALUE = config.valueTickets.halfTicket;
const SOCIAL_TICKET_VALUE = config.valueTickets.socialTicket;

/**
 * Calcula o total da compra, aplicando desconto do cupom se informado.
 * O cupom é validado contra o Firestore — não mais hardcoded.
 *
 * @param {number} allTickets
 * @param {number} halfTickets
 * @param {number} socialTickets
 * @param {string} coupon — código do cupom (opcional)
 * @returns {Promise<object>}
 */
const calculateTotal = async (allTickets, halfTickets, socialTickets, coupon) => {
  const ticketQuantity = allTickets + halfTickets + socialTickets;
  if (ticketQuantity <= 0) throw new Error('Selecione ao menos 1 ingresso.');

  const valueTicketsAll = allTickets * ALL_TICKET_VALUE;
  const valueTicketsHalf = halfTickets * HALF_TICKET_VALUE;
  const valueTicketsSocial = socialTickets * SOCIAL_TICKET_VALUE;

  let discount = 0;

  if (coupon && coupon.trim()) {
    const result = await CouponService.validateAndCalculate(
      coupon, allTickets, halfTickets, socialTickets
    );
    discount = result.discount;
  }

  const total = valueTicketsAll + valueTicketsHalf + valueTicketsSocial - discount;

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
