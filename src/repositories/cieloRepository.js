// src/repositories/CieloRepository.js
const axios = require("axios");
const config = require("../config");

class CieloRepository {
  #getHeaders() {
    return {
      "Content-Type": "application/json",
      MerchantId: config.cielo.merchantId,
      MerchantKey: config.cielo.merchantKey,
    };
  }

  async createCreditPayment(paymentData) {
    try {
      console.log("Enviando requisição de crédito à Cielo:", paymentData);
      const response = await axios.post(
        `${config.cielo.baseUrl}/1/sales`,
        paymentData,
        { headers: this.#getHeaders() }
      );
      console.log("Resposta da Cielo:", response.data);
      return {
        paymentId: response.data.Payment.PaymentId,
        status: response.data.Payment.Status,
        returnMessage: response.data.Payment.ReturnMessage,
      };
    } catch (error) {
      const errorMessage =
        error.response?.data?.[0]?.Message ||
        error.response?.data?.Message ||
        error.message ||
        "Erro ao processar o pagamento na Cielo";
      console.error("Erro na Cielo:", error.response?.data || error);
      throw new Error(errorMessage);
    }
  }

  async getPaymentStatus(paymentId) {
    try {
      console.log("Consultando status na Cielo para PaymentId:", paymentId);
      const response = await axios.get(
        `${config.cielo.baseQueryUrl}/1/sales/${paymentId}`,
        { headers: this.#getHeaders() }
      );
      console.log("Resposta do status:", response.data);
      return response.data.Payment;
    } catch (error) {
      console.error("Erro ao consultar status:", error);
      throw new Error("Erro ao verificar status na Cielo");
    }
  }

  async voidPayment(paymentId) {
    try {
      console.log("Estornando pagamento na Cielo para PaymentId:", paymentId);
      await axios.put(
        `${config.cielo.baseUrl}/1/sales/${paymentId}/void`,
        {},
        { headers: this.#getHeaders() }
      );
      console.log("Pagamento estornado com sucesso");
    } catch (error) {
      console.error("Erro ao estornar pagamento:", error);
      throw new Error("Erro ao estornar pagamento na Cielo");
    }
  }
}

module.exports = new CieloRepository();
