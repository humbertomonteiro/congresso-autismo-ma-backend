const axios = require("axios");
const config = require("../config");

class CieloService {
  async createCreditPayment(paymentData) {
    const headers = {
      "Content-Type": "application/json",
      MerchantId: config.cielo.merchantId,
      MerchantKey: config.cielo.merchantKey,
    };
    console.log("Headers (createCreditPayment):", headers);
    console.log("Body (createCreditPayment):", paymentData);

    const response = await axios.post(
      `${config.cielo.baseUrl}/1/sales`,
      paymentData,
      {
        headers: {
          "Content-Type": "application/json",
          MerchantId: config.cielo.merchantId,
          MerchantKey: config.cielo.merchantKey,
        },
      }
    );
    console.log("Resposta (createCreditPayment):", response.data);

    return {
      paymentId: response.data.Payment.PaymentId,
      status: response.data.Payment.Status,
    };
  }

  async getPaymentStatus(paymentId, merchantOrderId) {
    const headers = {
      "Content-Type": "application/json",
      MerchantId: config.cielo.merchantId,
      MerchantKey: config.cielo.merchantKey,
    };
    console.log("Headers (getPaymentStatus):", headers);

    const response = await axios.get(
      `${config.cielo.baseQueryUrl}/1/sales?paymentId=${paymentId}&merchantOrderId=${merchantOrderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          MerchantId: config.cielo.merchantId,
          MerchantKey: config.cielo.merchantKey,
        },
      }
    );
    console.log("Resposta (getPaymentStatus):", response.data);

    if (!response.data || response.data.length === 0) {
      throw new Error(
        "Resposta da Cielo não contém dados de pagamento válidos"
      );
    }
    if (response.data[0]?.Payment) {
      return response.data[0].Payment;
    }
    if (response.data?.Payment) {
      return response.data.Payment;
    }
    throw new Error("Resposta da Cielo não contém dados de pagamento válidos");
  }

  async voidPayment(paymentId) {
    const headers = {
      "Content-Type": "application/json",
      MerchantId: config.cielo.merchantId,
      MerchantKey: config.cielo.merchantKey,
    };
    const body = {};
    console.log("Headers (voidPayment):", headers);
    console.log("Body (voidPayment):", body);

    await axios.put(
      `${config.cielo.baseUrl}/1/sales/${paymentId}/void`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          MerchantId: config.cielo.merchantId,
          MerchantKey: config.cielo.merchantKey,
        },
      }
    );
    console.log("Resposta (voidPayment):", "Cancelamento concluído");
  }

  async fetchCieloSales() {
    const headers = {
      "Content-Type": "application/json",
      MerchantId: config.cielo.merchantId,
      MerchantKey: config.cielo.merchantKey,
    };
    console.log("Headers (fetchCieloSales):", headers);

    const response = await axios.get(`${config.cielo.baseQueryUrl}/1/sales`, {
      headers: {
        "Content-Type": "application/json",
        MerchantId: config.cielo.merchantId,
        MerchantKey: config.cielo.merchantKey,
      },
    });
    console.log("Resposta (fetchCieloSales):", response.data);
    return response.data;
  }
}

module.exports = new CieloService();
