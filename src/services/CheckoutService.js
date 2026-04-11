const CheckoutRepository = require("../repositories/CheckoutRepository");
const BancoDoBrasilService = require("./BancoDoBrasilService");
const EmailService = require("./EmailService");
const CieloService = require("./CieloService");
const { toZonedTime } = require("date-fns-tz");
const { endOfDay, parse } = require("date-fns");
const config = require("../config");
const logger = require("../logger");
const { calculateTotal } = require("../utils/calculateTotal");

const ALL_TICKET_VALUE = config.valueTickets.allTicket;
const HALF_TICKET_VALUE = config.valueTickets.halfTicket;
const SOCIAL_TICKET_VALUE = config.valueTickets.socialTicket;

class CheckoutService {
  // ── Cálculos ──────────────────────────────────────────────────────────────

  // Desconto aplicado apenas sobre ingressos inteiros (allTickets)
  calculateDiscount(allTickets, pricePerTicket) {
    return allTickets * (ALL_TICKET_VALUE - pricePerTicket);
  }

  // calculateTotal(allTickets, halfTickets, socialTickets, coupon) {
  //   const a = Number.isInteger(allTickets) && allTickets >= 0;
  //   const h = Number.isInteger(halfTickets) && halfTickets >= 0;
  //   const s = Number.isInteger(socialTickets) && socialTickets >= 0;
  //   if (!a || !h || !s) {
  //     throw new Error("Quantidade de ingressos inválida.");
  //   }
  //   const ticketQuantity = allTickets + halfTickets + socialTickets;
  //   if (ticketQuantity <= 0) {
  //     throw new Error("Selecione ao menos 1 ingresso.");
  //   }

  //   const valueTicketsAll = allTickets * ALL_TICKET_VALUE;
  //   const valueTicketsHalf = halfTickets * HALF_TICKET_VALUE;
  //   const valueTicketsSocial = socialTickets * SOCIAL_TICKET_VALUE;

  //   // Cupons aplicam desconto somente nos ingressos inteiros (allTickets)
  //   const couponMap = {
  //     grupo: () =>
  //       allTickets >= 5
  //         ? this.calculateDiscount(allTickets, 649)
  //         : (() => {
  //             throw new Error("Cupom 'grupo' exige mínimo 5 ingressos inteiros.");
  //           })(),
  //     grupo2: () => this.calculateDiscount(allTickets, 699),
  //     grupounico: () => this.calculateDiscount(allTickets, 449),
  //     terapeuta: () => 50,
  //     desconto: () => 50,
  //     prevenda: () => allTickets * 50,
  //     maira: () => this.calculateDiscount(allTickets, 350),
  //     vania: () => this.calculateDiscount(allTickets, 349.9),
  //     vivian: () => this.calculateDiscount(allTickets, 325.9),
  //     ingresso300: () => this.calculateDiscount(allTickets, 300),
  //   };

  //   let discount = 0;
  //   if (coupon) {
  //     const fn = couponMap[coupon];
  //     if (!fn) throw new Error("Cupom inválido.");
  //     discount = fn();
  //   }

  //   const total = valueTicketsAll + valueTicketsHalf + valueTicketsSocial - discount;
  //   return {
  //     allTickets,
  //     halfTickets,
  //     socialTickets,
  //     ticketQuantity,
  //     valueTicketsAll: valueTicketsAll.toFixed(2),
  //     valueTicketsHalf: valueTicketsHalf.toFixed(2),
  //     valueTicketsSocial: valueTicketsSocial.toFixed(2),
  //     discount: discount.toFixed(2),
  //     total: total.toFixed(2),
  //     totalInCents: Math.round(total * 100),
  //   };
  // }

  // ── Validações ────────────────────────────────────────────────────────────

  async calculateTotal(allTickets, halfTickets, socialTickets, coupon) {
    return calculateTotal(allTickets, halfTickets, socialTickets, coupon);
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
      if (!p.name || !p.email || !p.document) {
        throw new Error("Todos os campos do participante são obrigatórios.");
      }
      const cleanDoc = p.document.replace(/\D/g, "");
      // Valida CPF (11 dígitos) ou CNPJ (14 dígitos)
      if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
        throw new Error(
          `Documento inválido para ${p.name}: deve ser CPF (11) ou CNPJ (14) dígitos.`
        );
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
      throw new Error("Data de vencimento inválida (formato MM/AAAA).");
    }
    if (!/^\d{3,4}$/.test(cardCode)) {
      throw new Error("Código de segurança inválido.");
    }
    return true;
  }

  validateBoleto() {
    return true; // endereço é opcional por ora
  }

  // ── Verificação de pagamentos pendentes ───────────────────────────────────

  async verifyAllPendingPayments() {
    logger.info("[CheckoutService] Verificando pagamentos pendentes...");

    const pendingCheckouts = await CheckoutRepository.getPendingCheckouts();
    logger.info(
      `[CheckoutService] ${pendingCheckouts.length} checkout(s) pendente(s)`
    );

    for (const checkout of pendingCheckouts) {
      const { id, paymentMethod, paymentId, paymentDetails } = checkout;

      try {
        const now = toZonedTime(new Date(), "America/Sao_Paulo");
        let isExpired = false;

        if (paymentMethod === "pix" && paymentDetails?.pix?.expirationDate) {
          isExpired = new Date(paymentDetails.pix.expirationDate) < now;
        } else if (
          paymentMethod === "boleto" &&
          paymentDetails?.boleto?.dataVencimento
        ) {
          const vencimento = parse(
            paymentDetails.boleto.dataVencimento,
            "dd.MM.yyyy",
            new Date()
          );
          isExpired = endOfDay(vencimento) < now;
        }

        if (isExpired) {
          logger.info(`[CheckoutService] Checkout ${id} expirado`);
          await CheckoutRepository.updateCheckoutStatus(id, "expired");
          continue;
        }

        let newStatus;
        if (paymentMethod === "pix") {
          newStatus = await BancoDoBrasilService.getPixStatus(paymentId);
        } else if (paymentMethod === "boleto") {
          newStatus = await BancoDoBrasilService.getBoletoStatus(paymentId);
        } else if (paymentMethod === "credit") {
          newStatus = await CieloService.getPaymentStatus(paymentId);
        } else {
          logger.warn(
            `[CheckoutService] Método desconhecido para checkout ${id}: ${paymentMethod}`
          );
          continue;
        }

        logger.info(
          `[CheckoutService] Checkout ${id} (${paymentMethod}): ${newStatus}`
        );
        await CheckoutRepository.updateCheckoutStatus(id, newStatus);

        // Se aprovado, dispara emails de confirmação
        if (newStatus === "approved") {
          await this._sendConfirmationEmailsForCheckout(checkout);
        }
      } catch (error) {
        logger.error(
          `[CheckoutService] Erro no checkout ${id}: ${error.message}`
        );
      }
    }

    logger.info("[CheckoutService] Verificação concluída");
  }

  async verifyPaymentById(checkoutId) {
    const checkout = await CheckoutRepository.getCheckoutById(checkoutId);
    if (!checkout) return { status: "not_found" };

    const { paymentMethod, paymentId, paymentDetails } = checkout;
    const now = toZonedTime(new Date(), "America/Sao_Paulo");

    // Verifica expiração antes de consultar a API
    if (paymentMethod === "pix" && paymentDetails?.pix?.expirationDate) {
      if (new Date(paymentDetails.pix.expirationDate) < now) {
        await CheckoutRepository.updateCheckoutStatus(checkoutId, "expired");
        return { status: "expired" };
      }
    } else if (
      paymentMethod === "boleto" &&
      paymentDetails?.boleto?.dataVencimento
    ) {
      const vencimento = parse(
        paymentDetails.boleto.dataVencimento,
        "dd.MM.yyyy",
        new Date()
      );
      if (endOfDay(vencimento) < now) {
        await CheckoutRepository.updateCheckoutStatus(checkoutId, "expired");
        return { status: "expired" };
      }
    }

    let newStatus;
    if (paymentMethod === "pix") {
      newStatus = await BancoDoBrasilService.getPixStatus(paymentId);
    } else if (paymentMethod === "boleto") {
      newStatus = await BancoDoBrasilService.getBoletoStatus(paymentId);
    } else if (paymentMethod === "credit") {
      newStatus = await CieloService.getPaymentStatus(paymentId);
    } else {
      throw new Error(`Método de pagamento desconhecido: ${paymentMethod}`);
    }

    await CheckoutRepository.updateCheckoutStatus(checkoutId, newStatus);

    if (newStatus === "approved") {
      await this._sendConfirmationEmailsForCheckout(checkout);
    }

    return { status: newStatus };
  }

  // ── Interno: dispara emails de confirmação após aprovação ─────────────────

  async _sendConfirmationEmailsForCheckout(checkout) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(
      checkout.id
    );

    for (const participant of participants) {
      if (participant.emailSent) continue;
      try {
        await EmailService.sendEmailConfirmationPayment({
          checkoutId: checkout.id,
          participantId: participant.id,
          data: {
            transactionId:
              checkout.transactionId || checkout.paymentId || "N/A",
            fullTickets:
              checkout.orderDetails?.allTickets ??
              checkout.orderDetails?.fullTickets ??
              0,
            halfTickets: checkout.orderDetails?.halfTickets || 0,
            socialTickets: checkout.orderDetails?.socialTickets || 0,
            valueTicketsAll: checkout.orderDetails?.valueTicketsAll || "0.00",
            valueTicketsHalf: checkout.orderDetails?.valueTicketsHalf || "0.00",
            valueTicketsSocial:
              checkout.orderDetails?.valueTicketsSocial || "0.00",
            total: checkout.orderDetails?.total || "0.00",
            discount: checkout.orderDetails?.discount || "0.00",
            coupon: checkout.orderDetails?.coupon || "",
            installments:
              checkout.paymentDetails?.creditCard?.installments || 1,
          },
        });
      } catch (err) {
        logger.error(
          `[CheckoutService] Erro ao enviar email para ${participant.email}: ${err.message}`
        );
      }
    }
  }
}

module.exports = new CheckoutService();
