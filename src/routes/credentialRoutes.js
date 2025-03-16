// src/routes/credentialRoutes.js
const express = require("express");
const router = express.Router();
const credentialController = require("../controllers/CredentialController");

// Rotas de credenciais e QR codes
router.post(
  "/generate-qr-codes",
  credentialController.generateQRCodesForParticipant
);
router.post("/validate-qr-code", credentialController.validateQRCode);

module.exports = router;
