const config = require("../config");

const ALL_TICKET_VALUE = config.valueTickets.allTicket;
const HALF_TICKET_VALUE = config.valueTickets.halfTicket;
const SOCIAL_TICKET_VALUE = config.valueTickets.socialTicket;

const calculateTotal = (allTickets, halfTickets, socialTickets, coupon) => {
  const ticketQuantity = allTickets + halfTickets + socialTickets;
  if (ticketQuantity <= 0) throw new Error("Selecione ao menos 1 ingresso.");

  const valueTicketsAll = allTickets * ALL_TICKET_VALUE;
  const valueTicketsHalf = halfTickets * HALF_TICKET_VALUE;
  const valueTicketsSocial = socialTickets * SOCIAL_TICKET_VALUE;

  const couponMap = {
    grupo: () =>
      allTickets >= 5
        ? allTickets * (ALL_TICKET_VALUE - 347.9)
        : (() => {
            throw new Error("Cupom 'grupo' exige mínimo 5 ingressos inteiros.");
          })(),
    maira: () => allTickets * (ALL_TICKET_VALUE - 347.9),
    anapaula: () => allTickets * (ALL_TICKET_VALUE - 300),
    terapeuta: () => allTickets * (ALL_TICKET_VALUE - 297),
    vargemgrande: () => allTickets * (ALL_TICKET_VALUE - 349.9),
    testepagamento: () => allTickets * (ALL_TICKET_VALUE - 1),
  };

  let discount = 0;
  if (coupon) {
    const fn = couponMap[coupon];
    if (!fn) throw new Error("Cupom inválido.");
    discount = fn();
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
