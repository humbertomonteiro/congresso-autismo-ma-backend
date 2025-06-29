const CheckoutRepository = require("../repositories/CheckoutRepository");
const BancoDoBrasilService = require("./BancoDoBrasilService");
const EmailService = require("../services/EmailService"); // Adicionado
const { toZonedTime, format } = require("date-fns-tz");
const { startOfDay, endOfDay, parse } = require("date-fns");

class CheckoutService {
  constructor() {
    this.basePrice = 798;
    this.halfPrice = 399;
  }

  calculateDiscount(fullTickets, halfTickets, valueTicket) {
    const resultDiscontAllTickets = this.basePrice - valueTicket;
    const resultDiscontHalfTickets = this.halfPrice - valueTicket;

    const discount =
      fullTickets * resultDiscontAllTickets +
      halfTickets * resultDiscontHalfTickets;

    return discount;
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
      discount = this.calculateDiscount(fullTickets, halfTickets, 649);
    } else if (coupon === "grupo2") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 699);
    } else if (coupon === "terapeuta") {
      discount = 50;
    } else if (coupon === "desconto") {
      discount = 50;
    } else if (coupon === "maira") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 350);
    } else if (coupon === "vania") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 349.9);
    } else if (coupon === "vivian") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 325.9);
    } else if (coupon === "ingresso300") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 300);
    } else if (coupon === "prevenda") {
      discount = fullTickets * 50;
    } else if (coupon === "grupounico") {
      discount = this.calculateDiscount(fullTickets, halfTickets, 449);
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
    console.log(
      "[CheckoutService] Participantes recebidos:",
      JSON.stringify(participants, null, 2)
    );
    if (
      !Array.isArray(participants) ||
      participants.length !== ticketQuantity
    ) {
      throw new Error(
        "Número de participantes deve igualar a quantidade de ingressos."
      );
    }

    participants.forEach((p) => {
      if (!p.name || !p.email || !p.number || !p.document || !p.documentType) {
        console.error("[CheckoutService] Participante com campos faltando:", p);
        throw new Error("Todos os campos do participante são obrigatórios.");
      }
      const cleanDoc = p.document.replace(/\D/g, "");
      if (p.documentType === "cpf" && !/^\d{11}$/.test(cleanDoc)) {
        throw new Error(`CPF inválido para ${p.name}.`);
      }
      if (p.documentType === "cnpj" && !/^\d{14}$/.test(cleanDoc)) {
        throw new Error(`CNPJ inválido para ${p.name}.`);
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
      throw new Error(
        "Data de vencimento inválida (formato MM/AAAA). Ex: 05/2028"
      );
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
    // const { street, addressNumber, district, zipCode, city, state } =
    //   boletoData;
    // if (!street || !addressNumber || !district || !zipCode || !city || !state) {
    //   throw new Error(
    //     "Todos os campos de endereço são obrigatórios para boleto."
    //   );
    // }
    // if (!/^\d{8}$/.test(zipCode.replace(/\D/g, ""))) {
    //   throw new Error("CEP inválido.");
    // }
    // if (!/^[A-Z]{2}$/.test(state)) {
    //   throw new Error("Estado deve ser uma sigla de 2 letras (ex.: SP).");
    // }
    return true;
  }

  async verifyAllPendingPayments() {
    console.log(
      "[CheckoutService] Verificando todos os pagamentos pendentes..."
    );

    try {
      const pendingCheckouts = await CheckoutRepository.getPendingCheckouts();
      console.log(
        `[CheckoutService] Encontrados ${pendingCheckouts.length} checkouts pendentes`
      );

      for (const checkout of pendingCheckouts) {
        const { id, paymentMethod, paymentId, paymentDetails } = checkout;
        console.log(
          `[CheckoutService] Processando checkout ${id} - paymentId: ${paymentId}, método: ${paymentMethod}`
        );
        // const now = new Date();
        const now = toZonedTime(new Date(), "America/Sao_Paulo");

        let isExpired = false;
        if (paymentMethod === "pix" && paymentDetails.pix?.expirationDate) {
          isExpired = new Date(paymentDetails.pix.expirationDate) < now;
        } else if (
          paymentMethod === "boleto" &&
          paymentDetails.boleto?.dataVencimento
        ) {
          const vencimento = parse(
            paymentDetails.boleto.dataVencimento,
            "dd.MM.yyyy",
            new Date(),
            { timeZone: "America/Sao_Paulo" }
          );
          const vencimentoEndOfDay = endOfDay(vencimento);
          isExpired = vencimentoEndOfDay < now;
          console.log(
            `[CheckoutService] Boleto ${id}: dataVencimento=${paymentDetails.boleto.dataVencimento}, vencimento=${vencimento}, vencimentoEndOfDay=${vencimentoEndOfDay}, now=${now}, isExpired=${isExpired}`
          );
          // isExpired = new Date(paymentDetails.boleto.dataVencimento) < now;
        }

        if (isExpired) {
          console.log(
            `[CheckoutService] Checkout ${id} (${paymentMethod}) expirado`
          );
          await CheckoutRepository.updateCheckoutStatus(id, "error", null);
          await CheckoutRepository.resetAndUpdatePendingEmails(id, "error"); // Adicionado aqui
          continue;
        }

        let newStatus;
        try {
          if (paymentMethod === "pix") {
            newStatus = await BancoDoBrasilService.getPixStatus(paymentId);
          } else if (paymentMethod === "boleto") {
            const boletoNumber = paymentId;
            console.log(
              `[CheckoutService] Usando boletoNumber: ${boletoNumber}`
            );
            newStatus = await BancoDoBrasilService.getBoletoStatus(
              boletoNumber
            );
          } else {
            console.log(
              `[CheckoutService] Método de pagamento desconhecido para checkout ${id}: ${paymentMethod}`
            );
            continue;
          }

          console.log(
            `[CheckoutService] Status do checkout ${id} (${paymentMethod}): ${newStatus}`
          );
          await CheckoutRepository.updateCheckoutStatus(
            id,
            newStatus,
            newStatus === "approved"
              ? EmailService.sendEmailConfirmationPayment.bind(EmailService)
              : null
          );
          await CheckoutRepository.resetAndUpdatePendingEmails(id, newStatus);
        } catch (error) {
          console.error(
            `[CheckoutService] Erro ao verificar checkout ${id} (${paymentMethod}): ${error.message}`
          );
        }
      }

      console.log("[CheckoutService] Verificação de pendentes concluída");
    } catch (error) {
      console.error(
        "[CheckoutService] Erro geral ao verificar pendentes:",
        error.message
      );
      throw error;
    }
  }

  async verifyPaymentById(paymentId) {
    // console.log(
    //   `[CheckoutService] Verificando pagamento específico: ${paymentId}`
    // );

    try {
      const statusBoleto = BancoDoBrasilService.getBoletoStatus(paymentId);
      console.log("Status dos boletos:", statusBoleto);

      // const checkouts = await CheckoutRepository.getPendingCheckouts();
      // const checkout = checkouts.find((c) => c.paymentId === paymentId);

      // if (!checkout) {
      //   console.log(
      //     `[CheckoutService] Checkout com paymentId ${paymentId} não encontrado ou não está pendente`
      //   );
      //   return { status: "not_found" };
      // }

      // const { id, paymentMethod, paymentDetails } = checkout;
      // console.log(
      //   `[CheckoutService] Checkout encontrado - ID: ${id}, método: ${paymentMethod}`
      // );
      // const now = new Date();

      // let isExpired = false;
      // if (paymentMethod === "pix" && paymentDetails.pix?.expirationDate) {
      //   isExpired = new Date(paymentDetails.pix.expirationDate) < now;
      // } else if (
      //   paymentMethod === "boleto" &&
      //   paymentDetails.boleto?.dataVencimento
      // ) {
      //   isExpired = new Date(paymentDetails.boleto.dataVencimento) < now;
      // }

      // if (isExpired) {
      //   console.log(
      //     `[CheckoutService] Checkout ${id} (${paymentMethod}) expirado`
      //   );
      //   await CheckoutRepository.updateCheckoutStatus(id, "error", null);
      //   await CheckoutRepository.resetAndUpdatePendingEmails(id, "error"); // Adicionado aqui
      //   return { status: "error" };
      // }

      // let newStatus;
      // if (paymentMethod === "pix") {
      //   newStatus = await BancoDoBrasilService.getPixStatus(paymentId);
      // } else if (paymentMethod === "boleto") {
      //   const boletoNumber = paymentId;
      //   console.log(`[CheckoutService] Usando boletoNumber: ${boletoNumber}`);
      //   newStatus = await BancoDoBrasilService.getBoletoStatus(boletoNumber);
      // } else {
      //   throw new Error(`Método de pagamento desconhecido: ${paymentMethod}`);
      // }

      // console.log(
      //   `[CheckoutService] Status do checkout ${id} (${paymentMethod}): ${newStatus}`
      // );
      // await CheckoutRepository.updateCheckoutStatus(
      //   id,
      //   newStatus,
      //   newStatus === "approved"
      //     ? EmailService.sendEmailConfirmationPayment
      //     : null
      // );
      // await CheckoutRepository.resetAndUpdatePendingEmails(id, newStatus); // Adicionado aqui
      // return { status: newStatus };
    } catch (error) {
      console.error(
        `[CheckoutService] Erro ao verificar pagamento ${paymentId}: ${error.message}`
      );
      throw error;
    }
  }
}

module.exports = new CheckoutService();
