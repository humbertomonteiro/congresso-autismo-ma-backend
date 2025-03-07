// backend/src/repositories/cieloRepository.js
const axios = require("axios");
const { cieloConfig } = require("../config");

class CieloRepository {
  async createCreditPayment(paymentData) {
    try {
      console.log("Enviando requisição de crédito à Cielo:", paymentData);
      const response = await axios.post(
        `${cieloConfig.baseUrl}/1/sales`,
        paymentData,
        {
          headers: {
            "Content-Type": "application/json",
            MerchantId: cieloConfig.merchantId,
            MerchantKey: cieloConfig.merchantKey,
          },
        }
      );
      console.log("Resposta da Cielo para crédito:", response.data);

      const payment = response.data.Payment;
      const successCodes = ["4", "6"]; // Códigos de sucesso para crédito
      if (!successCodes.includes(payment.ReturnCode)) {
        throw new Error(
          payment.ReturnMessage ||
            "Erro desconhecido ao processar o pagamento com cartão"
        );
      }

      return {
        success: true,
        message: "Pagamento com cartão processado com sucesso!",
        type:
          payment.Status === 1 || payment.Status === 2 ? "approved" : "pending",
        transactionId: paymentData.MerchantOrderId,
        paymentId: payment.PaymentId,
      };
    } catch (error) {
      const errorMessage =
        error.response?.data?.[0]?.Message || // Ajuste para erros em array
        error.response?.data?.Message ||
        error.message ||
        "Erro ao processar o pagamento na Cielo";
      console.error(
        "Erro detalhado na Cielo (crédito):",
        error.response?.data || error
      );
      throw new Error(errorMessage);
    }
  }

  async createPixPayment(paymentData) {
    try {
      console.log("Enviando requisição de Pix à Cielo:", paymentData);
      const response = await axios.post(
        `${cieloConfig.baseUrl}/1/sales`,
        paymentData,
        {
          headers: {
            "Content-Type": "application/json",
            MerchantId: cieloConfig.merchantId,
            MerchantKey: cieloConfig.merchantKey,
          },
        }
      );
      console.log("Resposta completa da Cielo para Pix:", response.data);

      const payment = response.data.Payment;
      if (payment.Status !== 20) {
        // 20 = Pix aguardando pagamento
        throw new Error(
          payment.ReturnMessage || "Erro desconhecido ao gerar o Pix"
        );
      }

      return {
        success: true,
        message: "Pix gerado com sucesso!",
        type: "pending",
        transactionId: paymentData.MerchantOrderId,
        paymentId: payment.PaymentId,
        qrCode: payment.QrCodeBase64 || payment.QrCode,
        qrCodeString: payment.QrCodeString,
      };
    } catch (error) {
      const errorMessage =
        error.response?.data?.[0]?.Message || // Ajuste para erros em array
        error.response?.data?.Message ||
        error.message ||
        "Erro ao processar o Pix na Cielo";
      console.error(
        "Erro detalhado na Cielo (Pix):",
        error.response?.data || error
      );
      throw new Error(errorMessage);
    }
  }

  async createBoleto(paymentData) {
    try {
      console.log("Enviando requisição de Boleto à Cielo:", paymentData);
      const response = await axios.post(
        `${cieloConfig.baseUrl}/1/sales`,
        paymentData,
        {
          headers: {
            "Content-Type": "application/json",
            MerchantId: cieloConfig.merchantId,
            MerchantKey: cieloConfig.merchantKey,
          },
        }
      );
      console.log("Resposta da Cielo para Boleto:", response.data);

      const payment = response.data.Payment;
      const successCodes = ["200", "201"]; // Códigos de sucesso para boleto
      if (!successCodes.includes(payment.ReturnCode)) {
        throw new Error(
          payment.ReturnMessage || "Erro desconhecido ao gerar o boleto"
        );
      }

      return {
        success: true,
        message: "Boleto gerado com sucesso!",
        type: "pending",
        transactionId: paymentData.MerchantOrderId,
        paymentId: payment.PaymentId,
        boletoUrl: payment.Url,
      };
    } catch (error) {
      const errorMessage =
        error.response?.data?.[0]?.Message || // Ajuste para erros em array
        error.response?.data?.Message ||
        error.message ||
        "Erro ao processar o boleto na Cielo";
      console.error(
        "Erro detalhado na Cielo (Boleto):",
        error.response?.data || error
      );
      throw new Error(errorMessage);
    }
  }

  // Método para consultar status (usado no polling do controller)
  async getPaymentStatus(paymentId) {
    try {
      const response = await axios.get(
        `${cieloConfig.baseQueryUrl}/1/sales/${paymentId}`,
        {
          headers: {
            MerchantId: cieloConfig.merchantId,
            MerchantKey: cieloConfig.merchantKey,
          },
        }
      );
      return response.data.Payment;
    } catch (error) {
      console.error("Erro ao consultar status do pagamento:", error);
      throw new Error("Erro ao verificar status na Cielo");
    }
  }

  // Método para estornar pagamento
  async voidPayment(paymentId) {
    try {
      const response = await axios.put(
        `${cieloConfig.baseUrl}/1/sales/${paymentId}/void`,
        {},
        {
          headers: {
            MerchantId: cieloConfig.merchantId,
            MerchantKey: cieloConfig.merchantKey,
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error("Erro ao estornar pagamento:", error);
      throw new Error("Erro ao estornar pagamento na Cielo");
    }
  }
}

module.exports = new CieloRepository();
