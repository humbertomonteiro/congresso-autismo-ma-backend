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
  const { qrData, operator } = req.body;

  console.log("Dados recebidos no backend:", qrData);

  try {
    const result = await CredentialService.validateQRCode(qrData, operator);
    res.sendResponse(200, true, "Validação concluída", result);
  } catch (error) {
    console.error("Erro ao validar QR Code:", error.message);
    res.sendResponse(400, false, error.message, { isValid: false });
  }
};

const regenerateQRCode = async (req, res) => {
  const { checkoutId, participantId, participantName } = req.body;
  try {
    const CheckoutRepository = require("../repositories/CheckoutRepository");
    const config = require("../config");

    // Clear existing token so the service generates a fresh one with the current name
    await CheckoutRepository.updateParticipant(checkoutId, participantId, {
      qrToken: null,
    });

    const { qrToken } = await CredentialService.generateQRCodesForParticipant(
      checkoutId,
      participantId,
      participantName
    );

    // Build qrRawData (raw payload strings per date) for the admin modal
    const qrRawData = {};
    for (const date of config.event.dates) {
      qrRawData[date] = JSON.stringify({ ...JSON.parse(qrToken), date });
    }
    await CheckoutRepository.updateParticipant(checkoutId, participantId, { qrRawData });

    res.sendResponse(200, true, "QR regenerado com sucesso", { qrToken, qrRawData });
  } catch (error) {
    console.error("Erro ao regenerar QR:", error.message);
    res.sendResponse(500, false, "Erro ao regenerar QR", null, error.message);
  }
};

module.exports = {
  generateQRCodesForParticipant,
  validateQRCode,
  regenerateQRCode,
};
