class CheckoutService {
  constructor() {
    this.basePrice = 499;
    this.halfPrice = 399;
  }

  calculateTotal(ticketQuantity, halfTickets, coupon) {
    if (!Number.isInteger(ticketQuantity) || ticketQuantity <= 0) {
      throw new Error("Quantidade de ingressos inválida.");
    }
    if (
      !Number.isInteger(halfTickets) ||
      halfTickets < 0 ||
      halfTickets > ticketQuantity
    ) {
      throw new Error("Número de ingressos meia inválido.");
    }

    const fullTickets = ticketQuantity - halfTickets;
    const valueTicketsAll = fullTickets * this.basePrice;
    const valueTicketsHalf = halfTickets * this.halfPrice;
    let discount = 0;

    if (coupon === "grupo" && ticketQuantity >= 5) {
      discount = ticketQuantity * 50;
    } else if (coupon && coupon !== "grupo") {
      throw new Error("Cupom inválido.");
    }

    const total = valueTicketsAll + valueTicketsHalf - discount;

    return {
      valueTicketsAll: valueTicketsAll.toFixed(2),
      valueTicketsHalf: valueTicketsHalf.toFixed(2),
      discount: discount.toFixed(2),
      total: total.toFixed(2),
      totalInCents: Math.round(total * 100),
    };
  }

  validateParticipants(participants, ticketQuantity) {
    if (
      !Array.isArray(participants) ||
      participants.length !== ticketQuantity
    ) {
      throw new Error(
        "Número de participantes deve igualar a quantidade de ingressos."
      );
    }

    participants.forEach((p) => {
      if (!p.name || !p.email || !p.number || !p.cpf) {
        throw new Error("Todos os campos do participante são obrigatórios.");
      }
      if (!/^\d{11}$/.test(p.cpf.replace(/\D/g, ""))) {
        throw new Error(`CPF inválido para ${p.name}.`);
      }
    });

    return true;
  }

  validateCreditCard(cardData) {
    const { cardNumber, cardName, maturity, cardCode, installments } = cardData;
    if (!cardNumber || !cardName || !maturity || !cardCode || !installments) {
      throw new Error("Todos os campos do cartão são obrigatórios.");
    }
    if (!/^\d{13,19}$/.test(cardNumber.replace(/\s/g, ""))) {
      throw new Error("Número do cartão inválido.");
    }
    if (!/^\d{2}\/\d{4}$/.test(maturity)) {
      throw new Error("Data de vencimento inválida (formato MM/YYYY).");
    }
    if (!/^\d{3,4}$/.test(cardCode)) {
      throw new Error("Código de segurança inválido.");
    }
    if (
      !Number.isInteger(Number(installments)) ||
      installments < 1 ||
      installments > 10
    ) {
      throw new Error("Número de parcelas deve estar entre 1 e 10.");
    }
    return true;
  }

  validateBoleto(boletoData) {
    const { street, number, district, zipCode, city, state } = boletoData;
    if (!street || !number || !district || !zipCode || !city || !state) {
      throw new Error(
        "Todos os campos de endereço são obrigatórios para boleto."
      );
    }
    if (!/^\d{8}$/.test(zipCode.replace(/\D/g, ""))) {
      throw new Error("CEP inválido.");
    }
    if (!/^[A-Z]{2}$/.test(state)) {
      throw new Error("Estado deve ser uma sigla de 2 letras (ex.: SP).");
    }
    return true;
  }
}

module.exports = new CheckoutService();
