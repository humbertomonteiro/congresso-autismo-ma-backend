const CieloRepository = require("../repositories/CieloRepository");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const { buildParticipantsBatch } = require("../utils/normalizeParticipant");
const { toZonedTime } = require("date-fns-tz");
const config = require("../config");
const logger = require("../logger");

const EVENT_NAME = config.event.name;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mapCieloStatusToCustom = (cieloStatus) => {
  switch (cieloStatus) {
    case 1:
    case 2:
      return "approved";
    case 0:
    case 12:
      return "pending";
    case 3:
    case 13:
      return "denied";
    case 10:
      return "voided";
    case 11:
      return "refunded";
    default:
      return "pending";
  }
};

const normalizeBrand = (brand) => {
  const brandMap = {
    visa: "Visa",
    mastercard: "Master",
    amex: "Amex",
    elo: "Elo",
    diners: "Diners",
    discover: "Discover",
    jcb: "JCB",
    aura: "Aura",
    hipercard: "Hipercard",
  };
  return brandMap[brand?.toLowerCase()] || brand;
};

class CieloService {
  async processCreditPayment(
    allTickets,
    halfTickets,
    socialTickets,
    coupon,
    participants,
    creditCardData,
    totals,
    payer
  ) {
    let creditResponse;
    const normalizedBrand = normalizeBrand(creditCardData.brand);

    // Converte MM/AA → MM/YYYY para a API Cielo
    const rawMaturity = creditCardData.maturity || "";
    const expirationDate = /^\d{2}\/\d{2}$/.test(rawMaturity)
      ? `${rawMaturity.slice(0, 3)}20${rawMaturity.slice(3)}`
      : rawMaturity;

    const paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: payer.name,
        Identity: payer.document.replace(/\D/g, ""),
        IdentityType: payer.documentType || "cpf",
      },
      Payment: {
        Type: "CreditCard",
        Amount: totals.totalInCents,
        Installments: parseInt(creditCardData.installments),
        SoftDescriptor: EVENT_NAME,
        Capture: true,
        CreditCard: {
          CardNumber: creditCardData.cardNumber.replace(/\s/g, ""),
          Holder: creditCardData.cardName,
          ExpirationDate: expirationDate,
          SecurityCode: creditCardData.cardCode,
          Brand: normalizedBrand,
        },
      },
    };

    try {
      creditResponse = await CieloRepository.createCreditPayment(paymentData);

      // Aguarda status final
      let statusResponse = { Status: creditResponse.status };
      const finalStatuses = [1, 2, 3, 9, 11, 13];
      let attempts = 0;

      while (!finalStatuses.includes(statusResponse.Status) && attempts < 5) {
        await delay(5000);
        statusResponse = await CieloRepository.getPaymentStatus(
          creditResponse.paymentId
        );
        attempts++;
        logger.info(
          `[Cielo] Tentativa ${attempts}: Status ${statusResponse.Status}`
        );
      }

      const customStatus = mapCieloStatusToCustom(statusResponse.Status);
      if (customStatus === "denied") {
        throw new Error(
          `Transação não aprovada: ${
            creditResponse.returnMessage || "Negada pelo banco"
          }`
        );
      }

      const brasiliaTime = toZonedTime(new Date(), "America/Sao_Paulo");

      const checkoutData = {
        transactionId: paymentData.MerchantOrderId,
        timestamp: brasiliaTime.toISOString(),
        status: customStatus,
        paymentMethod: "credit",
        paymentId: creditResponse.paymentId,
        buyerName: payer.name,
        buyerCpf: payer.document.replace(/\D/g, ""),
        isCourtesy: false,
        eventName: EVENT_NAME,
        orderDetails: {
          allTickets,
          halfTickets,
          socialTickets,
          coupon: coupon || null,
          total: totals.total,
          discount: totals.discount,
          valueTicketsAll: totals.valueTicketsAll,
          valueTicketsHalf: totals.valueTicketsHalf,
          valueTicketsSocial: totals.valueTicketsSocial,
        },
        paymentDetails: {
          creditCard: {
            last4Digits: creditCardData.cardNumber.slice(-4),
            installments: parseInt(creditCardData.installments),
            brand: normalizedBrand,
          },
        },
      };

      const checkoutId = await CheckoutRepository.saveCheckout(checkoutData);

      // DEPOIS
      const CredentialService = require("./CredentialService");

      const participantsData = buildParticipantsBatch(participants, {
        checkoutId,
        allTickets,
        halfTickets,
      });
      const participantIds = await CheckoutRepository.saveParticipants(
        checkoutId,
        participantsData
      );

      // ✅ Gera qrToken para cada participante imediatamente após salvar
      for (let i = 0; i < participantIds.length; i++) {
        await CredentialService.generateQRCodesForParticipant(
          checkoutId,
          participantIds[i],
          participants[i].name
        );
      }

      // Dispara campanhas automáticas se aprovado
      if (customStatus === "approved") {
        const CampaignService = require("./CampaignService");
        await CampaignService.triggerForCheckout({
          id: checkoutId,
          ...checkoutData,
        });
      }

      return {
        paymentId: creditResponse.paymentId,
        checkoutId,
        participantIds,
        transactionId: paymentData.MerchantOrderId,
        status: customStatus,
        message:
          customStatus === "pending"
            ? "Pagamento em processamento, aguarde a confirmação."
            : "Pagamento processado com sucesso",
      };
    } catch (error) {
      logger.error(`[Cielo] Erro: ${error.message}`);

      // Estorna se foi aprovado antes do erro
      if (creditResponse?.paymentId) {
        const status = await CieloRepository.getPaymentStatus(
          creditResponse.paymentId
        );
        if ([1, 2].includes(status.Status)) {
          await CieloRepository.voidPayment(creditResponse.paymentId);
          logger.info("[Cielo] Pagamento estornado");
        }
      }

      throw error;
    }
  }

  async getPaymentStatus(paymentId) {
    const response = await CieloRepository.getPaymentStatus(paymentId);
    return mapCieloStatusToCustom(response.Status);
  }

  async fetchCieloSales() {
    throw new Error("Método fetchCieloSales não implementado");
  }
}

module.exports = new CieloService();
