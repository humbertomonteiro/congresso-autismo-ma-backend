// src/controllers/CredentialController.js
const CredentialService = require("../services/CredentialService");

const generateQRCodesForParticipant = async (req, res) => {
  const { checkoutId, participantIndex } = req.body;

  try {
    const { qrRawData } = await CredentialService.generateQRCodesForParticipant(
      checkoutId,
      participantIndex,
      req.body.participantName
    );
    res.sendResponse(200, true, "QR Codes gerados com sucesso", qrRawData);
  } catch (error) {
    console.error("Erro ao gerar QR Codes:", error.message);
    res.sendResponse(500, false, "Erro ao gerar QR Codes", null, error.message);
  }
};

const validateQRCode = async (req, res) => {
  const { qrData } = req.body;

  console.log("Dados recebidos no backend:", qrData);

  try {
    const result = await CredentialService.validateQRCode(qrData);
    res.sendResponse(200, true, "Validação concluída", result);
  } catch (error) {
    console.error("Erro ao validar QR Code:", error.message);
    res.sendResponse(400, false, error.message, { isValid: false });
  }
};

module.exports = {
  generateQRCodesForParticipant,
  validateQRCode,
};
