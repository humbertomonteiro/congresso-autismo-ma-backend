// backend/src/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/EmailController");
const paymentController = require("../controllers/PaymentController");
const credentialController = require("../controllers/CredentialController");
const cieloController = require("../controllers/CieloController");

router.post("/send-email", emailController.sendEmail);
router.post("/generate-email-template", emailController.generateEmailTemplate);
router.post(
  "/send-template-immediately",
  emailController.sendTemplateImmediately
);
router.post("/create-contact-list", emailController.createContactList);
router.post("/add-contact-to-list", emailController.addContactToList);
router.get("/fetch-cielo-sales", cieloController.fetchCieloSales);
router.post("/credit", paymentController.processCreditPayment);
router.post("/pix", paymentController.processPixPayment);
router.post("/boleto", paymentController.processBoletoPayment);
router.post("/validate-coupon", paymentController.validateCoupon);
router.post("/calculate-totals", paymentController.calculateTotals);
router.post(
  "/generate-qr-codes",
  credentialController.generateQRCodesForParticipant
);
router.post("/validate-qr-code", credentialController.validateQRCode);

module.exports = router;
