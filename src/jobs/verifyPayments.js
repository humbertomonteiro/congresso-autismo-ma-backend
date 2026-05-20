// src/jobs/verifyPayments.js
const cron = require("node-cron");
const CheckoutService = require("../services/CheckoutService");

const verifyPendingPayments = () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("[VerifyPayments] Sandbox — verificação automática desativada.");
    return;
  }
  cron.schedule("0 */6 * * *", () => {
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
