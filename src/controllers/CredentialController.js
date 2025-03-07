// backend/src/controllers/CredentialController.js
const { db } = require("../config");
const { doc, getDoc, updateDoc } = require("firebase/firestore");
const QRCode = require("qrcode");
const { sendResponse } = require("../utils/response");
const emailService = require("../services/emailService");

const EVENT_NAME = "Congresso Autismo MA 2025";
const EVENT_DATES = ["2025-05-31", "2025-06-01"]; // 31/05 e 01/06

// backend/src/controllers/CredentialController.js
const generateQRCodesForParticipant = async (req, res) => {
  const { checkoutId, participantIndex } = req.body;

  try {
    const checkoutRef = doc(db, "checkouts", checkoutId);
    const checkoutSnap = await getDoc(checkoutRef);
    if (!checkoutSnap.exists()) {
      throw new Error("Checkout não encontrado.");
    }

    const checkout = checkoutSnap.data();
    const participant = checkout.participants[participantIndex];
    if (!participant) {
      throw new Error("Participante não encontrado no checkout.");
    }

    const qrCodes = {};
    const qrRawData = {}; // Armazena o JSON puro
    for (const date of ["2025-05-31", "2025-06-01"]) {
      const qrData = JSON.stringify({
        checkoutId,
        participantId: `${checkoutId}-${participantIndex}`,
        participantName: participant.name,
        eventName: "Congresso Autismo MA 2025",
        date,
      });
      qrRawData[date] = qrData; // JSON puro
      qrCodes[date] = await QRCode.toDataURL(qrData); // Base64 para exibição
    }

    participant.qrCodes = qrCodes;
    participant.qrRawData = qrRawData; // Salva o JSON puro no Firebase
    participant.validated = { "2025-05-31": false, "2025-06-01": false };
    await updateDoc(checkoutRef, { participants: checkout.participants });

    const emailData = {
      from: process.env.EMAIL_USER_1,
      to: participant.email,
      subject: "Seus QR Codes - Congresso Autismo MA 2025",
      html: `
          <h2>Olá ${participant.name},</h2>
          <p>Aqui estão seus QR Codes para o Congresso Autismo MA 2025:</p>
          <h3>31 de maio de 2025</h3>
          <img src="${qrCodes["2025-05-31"]}" alt="QR Code 31/05" style="width: 200px;" />
          <h3>1º de junho de 2025</h3>
          <img src="${qrCodes["2025-06-01"]}" alt="QR Code 01/06" style="width: 200px;" />
          <p>Apresente esses QR Codes na entrada do evento em cada dia.</p>
          <p>Atenciosamente,<br>Equipe Congresso Autismo MA</p>
        `,
    };
    await emailService.sendEmail(emailData);

    sendResponse(
      res,
      200,
      true,
      "QR Codes gerados e enviados com sucesso",
      qrRawData
    ); // Retorna JSON puro
  } catch (error) {
    console.error("Erro ao gerar QR Codes:", error.message);
    sendResponse(
      res,
      500,
      false,
      "Erro ao gerar QR Codes",
      null,
      error.message
    );
  }
};

const validateQRCode = async (req, res) => {
  const { qrData } = req.body;

  try {
    const parsedData = JSON.parse(qrData); // Pode falhar se qrData não for JSON
    const { checkoutId, participantId, date } = parsedData;

    const checkoutRef = doc(db, "checkouts", checkoutId);
    const checkoutSnap = await getDoc(checkoutRef);
    if (!checkoutSnap.exists()) {
      throw new Error("Checkout não encontrado.");
    }

    const checkout = checkoutSnap.data();
    const participantIndex = parseInt(participantId.split("-")[1], 10);
    const participant = checkout.participants[participantIndex];

    if (!participant || !participant.qrCodes || !participant.qrCodes[date]) {
      throw new Error("QR Code inválido ou não encontrado.");
    }

    const isValid = participant.qrCodes[date] === qrData;
    if (!isValid) {
      throw new Error("QR Code inválido.");
    }

    if (participant.validated[date]) {
      throw new Error("QR Code já validado para este dia.");
    }

    participant.validated[date] = true;
    await updateDoc(checkoutRef, { participants: checkout.participants });

    sendResponse(res, 200, true, "Validação concluída", { isValid: true });
  } catch (error) {
    console.error("Erro ao validar QR Code:", error.message);
    sendResponse(res, 400, false, error.message, { isValid: false });
  }
};

module.exports = {
  generateQRCodesForParticipant,
  validateQRCode,
};
