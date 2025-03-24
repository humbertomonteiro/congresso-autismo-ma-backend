// src/services/CieloService.js
const CieloRepository = require("../repositories/CieloRepository");
const CheckoutRepository = require("../repositories/CheckoutRepository");

const EVENT_NAME = "Congresso Autismo MA 2025";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mapCieloStatusToCustom = (cieloStatus) => {
  switch (cieloStatus) {
    case 1:
    case 2:
      return "approved";
    case 0:
    case 10:
      return "pending";
    case 3:
    case 9:
    case 11:
      return "error";
    default:
      return "pending";
  }
};

// Função para normalizar a bandeira do cartão
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
  const lowerBrand = brand.toLowerCase();
  return brandMap[lowerBrand] || brand;
};

class CieloService {
  async processCreditPayment(
    ticketQuantity,
    halfTickets,
    coupon,
    participants,
    creditCardData,
    totals,
    payer
  ) {
    let creditResponse;
    let paymentData;

    try {
      // Normalizar o valor da bandeira antes de usar
      const normalizedBrand = normalizeBrand(creditCardData.brand);

      // Montar paymentData com o brand normalizado
      paymentData = {
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
          CreditCard: {
            CardNumber: creditCardData.cardNumber.replace(/\s/g, ""),
            Holder: creditCardData.cardName,
            ExpirationDate: creditCardData.maturity,
            SecurityCode: creditCardData.cardCode,
            Brand: normalizedBrand, // Usar o valor normalizado aqui
          },
        },
      };

      // Criar pagamento
      creditResponse = await CieloRepository.createCreditPayment(paymentData);

      // Verificar status com loop (igual ao antigo)
      let statusResponse = {
        Status: creditResponse.status,
        ReturnMessage: creditResponse.returnMessage,
      };
      const maxAttempts = 5;
      let attempts = 0;
      const finalStatuses = [1, 2, 3, 9, 11];

      do {
        statusResponse = await CieloRepository.getPaymentStatus(
          creditResponse.paymentId
        );
        console.log(
          `Tentativa ${attempts + 1}/${maxAttempts}: Status ${
            statusResponse.Status
          }`
        );
        if (finalStatuses.includes(statusResponse.Status)) break;
        attempts++;
        if (attempts < maxAttempts) {
          console.log("Aguardando 5 segundos antes da próxima tentativa...");
          await delay(5000);
        }
      } while (attempts < maxAttempts);

      const customStatus = mapCieloStatusToCustom(statusResponse.Status);
      if (customStatus === "error") {
        throw new Error(
          `Transação não aprovada: ${
            statusResponse.ReturnMessage || "Erro desconhecido"
          }`
        );
      }

      // Montar checkoutData
      const checkoutData = {
        transactionId: paymentData.MerchantOrderId,
        timestamp: new Date().toISOString(),
        status: customStatus,
        paymentMethod: "creditCard",
        totalAmount: totals.total,
        eventName: EVENT_NAME,
        participants,
        paymentId: creditResponse.paymentId,
        orderDetails: {
          ...totals,
          ticketQuantity,
          fullTickets: ticketQuantity - halfTickets,
          halfTickets,
          coupon: coupon || null,
        },
        paymentDetails: {
          creditCard: {
            last4Digits: creditCardData.cardNumber.slice(-4),
            installments: creditCardData.installments,
            brand: normalizedBrand, // Usar o valor normalizado aqui também
          },
        },
        document: participants[0].document || "",
        sentEmails: [],
      };

      // Salvar no Firebase
      await CheckoutRepository.saveCheckout(checkoutData);

      console.log("Response sendo retornado:", {
        paymentId: creditResponse.paymentId,
        transactionId: paymentData.MerchantOrderId,
        status: customStatus,
        message:
          customStatus === "pending"
            ? "Pagamento em processamento, aguarde a confirmação."
            : "Pagamento processado com sucesso",
        success: true,
      });

      return {
        paymentId: creditResponse.paymentId,
        transactionId: paymentData.MerchantOrderId,
        status: customStatus,
        message:
          customStatus === "pending"
            ? "Pagamento em processamento, aguarde a confirmação."
            : "Pagamento processado com sucesso",
        success: true,
      };
    } catch (error) {
      console.error("Erro no CieloService:", error.message);

      // Estornar se pagamento foi aprovado
      if (creditResponse?.paymentId) {
        const status = await CieloRepository.getPaymentStatus(
          creditResponse.paymentId
        );
        if ([1, 2].includes(status.Status)) {
          await CieloRepository.voidPayment(creditResponse.paymentId);
          console.log("Pagamento estornado com sucesso");
        }
      }

      // Salvar erro no Firebase
      const errorCheckoutData = {
        transactionId: paymentData?.MerchantOrderId || `ORDER_${Date.now()}`,
        timestamp: new Date().toISOString(),
        status: "error",
        paymentMethod: "creditCard",
        totalAmount: totals?.total || "0.00",
        eventName: EVENT_NAME,
        participants: participants || [],
        paymentId: creditResponse?.paymentId || null,
        orderDetails: totals
          ? {
              ...totals,
              ticketQuantity,
              fullTickets: ticketQuantity - halfTickets,
              halfTickets,
              coupon: coupon || null,
            }
          : {
              ticketQuantity,
              fullTickets: ticketQuantity - halfTickets,
              halfTickets,
              coupon: coupon || null,
              totalInCents: 0,
              total: "0.00",
            },
        paymentDetails: {
          creditCard: {
            last4Digits: creditCardData?.cardNumber?.slice(-4) || "N/A",
            installments: creditCardData?.installments || 1,
            brand: creditCardData?.brand || "Visa",
          },
        },
        sentEmails: [],
        errorLog: error.message,
      };

      await CheckoutRepository.saveCheckout(errorCheckoutData);
      throw error; // Propagar erro para o controller
    }
  }

  async fetchCieloSales() {
    throw new Error("Método fetchCieloSales não implementado ainda");
  }
}

module.exports = new CieloService();
