// src/services/CieloService.js
const axios = require("axios");
const config = require("../config");

class CieloService {
  async createCreditPayment(paymentData) {
    try {
      const requestUrl = `${config.cielo.baseUrl}/1/sales`;
      const requestHeaders = {
        "Content-Type": "application/json",
        MerchantId: config.cielo.merchantId,
        MerchantKey: config.cielo.merchantKey,
      };

      console.log("Enviando requisição para Cielo (createCreditPayment):", {
        url: requestUrl,
        headers: requestHeaders,
        body: paymentData, // Logando o body completo enviado no POST
      });

      const response = await axios.post(requestUrl, paymentData, {
        headers: requestHeaders,
      });

      console.log(
        "Resposta completa da Cielo em createCreditPayment:",
        response.data
      );

      return {
        paymentId: response.data.Payment.PaymentId,
        status: response.data.Payment.Status,
      };
    } catch (error) {
      console.error(
        "Erro ao criar pagamento na Cielo:",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async getPaymentStatus(paymentId, merchantOrderId) {
    try {
      const requestUrl = `${config.cielo.baseQueryUrl}/1/sales?paymentId=${paymentId}&merchantOrderId=${merchantOrderId}`;
      const requestHeaders = {
        "Content-Type": "application/json",
        MerchantId: config.cielo.merchantId,
        MerchantKey: config.cielo.merchantKey,
      };

      console.log("Enviando requisição para Cielo (getPaymentStatus):", {
        url: requestUrl,
        headers: requestHeaders,
        // Sem body em GET, não incluímos
      });

      const response = await axios.get(requestUrl, {
        headers: requestHeaders,
      });

      console.log(
        "Resposta completa da Cielo em getPaymentStatus:",
        response.data
      );

      if (
        response.data.Payments &&
        Array.isArray(response.data.Payments) &&
        response.data.Payments.length > 0
      ) {
        const payment = response.data.Payments[0];
        return {
          PaymentId: payment.PaymentId,
          Status: response.data.ReasonCode === 0 ? 1 : 3,
          ReturnMessage: response.data.ReasonMessage,
          ReceivedDate: payment.ReceveidDate,
        };
      } else if (
        Array.isArray(response.data) &&
        response.data.length > 0 &&
        response.data[0].Payment
      ) {
        return response.data[0].Payment;
      } else if (response.data && response.data.Payment) {
        return response.data.Payment;
      } else {
        throw new Error(
          "Resposta da Cielo não contém dados de pagamento válidos"
        );
      }
    } catch (error) {
      console.error(
        "Erro ao consultar status na Cielo:",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async voidPayment(paymentId) {
    try {
      const requestUrl = `${config.cielo.baseUrl}/1/sales/${paymentId}/void`;
      const requestHeaders = {
        "Content-Type": "application/json",
        MerchantId: config.cielo.merchantId,
        MerchantKey: config.cielo.merchantKey,
      };
      const requestBody = {}; // Body vazio para o PUT da Cielo

      console.log("Enviando requisição para Cielo (voidPayment):", {
        url: requestUrl,
        headers: requestHeaders,
        body: requestBody, // Logando o body (vazio neste caso)
      });

      const response = await axios.put(requestUrl, requestBody, {
        headers: requestHeaders,
      });

      console.log("Resposta completa da Cielo em voidPayment:", response.data);
    } catch (error) {
      console.error(
        "Erro ao cancelar pagamento na Cielo:",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async fetchCieloSales() {
    try {
      const requestUrl = `${config.cielo.baseQueryUrl}/1/sales`;
      const requestHeaders = {
        "Content-Type": "application/json",
        MerchantId: config.cielo.merchantId,
        MerchantKey: config.cielo.merchantKey,
      };

      console.log("Enviando requisição para Cielo (fetchCieloSales):", {
        url: requestUrl,
        headers: requestHeaders,
        // Sem body em GET, não incluímos
      });

      const response = await axios.get(requestUrl, {
        headers: requestHeaders,
      });

      console.log(
        "Resposta completa da Cielo em fetchCieloSales:",
        response.data
      );
      return response.data;
    } catch (error) {
      console.error(
        "Erro ao buscar vendas na Cielo:",
        error.response?.data || error.message
      );
      throw error;
    }
  }
}

module.exports = new CieloService();
