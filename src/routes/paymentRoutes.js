// src/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/PaymentController");

router.post("/credit", paymentController.processCreditPayment);
router.post("/pix", paymentController.processPixPayment);
router.post("/boleto", paymentController.processBoletoPayment);
router.post("/validate-coupon", paymentController.validateCoupon);
router.post("/calculate-totals", paymentController.calculateTotals);
router.get("/fetch-cielo-sales", paymentController.fetchCieloSales);
router.get("/verify/:paymentId", paymentController.verifyPayment);
router.get("/verify-all", paymentController.verifyAllPayments);
router.post(
  "/add-templates-to-pending-emails",
  paymentController.addAllTemplatesToPendingEmails
);

module.exports = router;
