// src/jobs/verifyPayments.js
const cron = require("node-cron");
const CheckoutService = require("../services/CheckoutService");

const verifyPendingPayments = () => {
  cron.schedule("0 */6 * * *", () => {
    // A cada 6 horas
    console.log(
      "[VerifyPayments] Executando verificação automática de pagamentos pendentes..."
    );
    CheckoutService.verifyAllPendingPayments().catch((error) =>
      console.error(
        "[VerifyPayments] Erro na verificação automática:",
        error.message
      )
    );
  });
};

module.exports = { verifyPendingPayments };
