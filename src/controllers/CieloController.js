// backend/src/controllers/cieloController.js
const axios = require("axios");
const { db, cieloConfig } = require("../config");
const { collection, addDoc } = require("firebase/firestore");

const fetchCieloSales = async (req, res) => {
  try {
    const response = await axios.get(`${cieloConfig.baseQueryUrl}/1/sales`, {
      headers: {
        "Content-Type": "application/json",
        MerchantId: cieloConfig.merchantId,
        MerchantKey: cieloConfig.merchantKey,
      },
    });

    const sales = response.data;
    for (const sale of sales) {
      const checkoutData = {
        transactionId: sale.Payment.PaymentId,
        status:
          sale.Payment.Status === 1 || sale.Payment.Status === 2
            ? "approved"
            : "pending",
        paymentMethod: sale.Payment.Type,
        totalAmount: (sale.Payment.Amount / 100).toFixed(2),
        participants: [
          { email: "cliente@exemplo.com", name: "Cliente Exemplo" }, // Ajuste conforme necessário
        ],
        orderDetails: {
          fullTickets: 1, // Ajuste conforme dados reais
          halfTickets: 0,
          fullTicketsValue: (sale.Payment.Amount / 100).toFixed(2),
          halfTicketsValue: "0.00",
          discount: "0.00",
        },
        timestamp: new Date().toISOString(),
      };
      await addDoc(collection(db, "checkouts"), checkoutData);
    }

    res.status(200).json({ message: "Vendas da Cielo importadas com sucesso" });
  } catch (error) {
    console.error("Erro ao buscar vendas da Cielo:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { fetchCieloSales };
