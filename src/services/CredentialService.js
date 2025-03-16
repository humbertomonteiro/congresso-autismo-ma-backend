const QRCode = require("qrcode");
const crypto = require("crypto");
require("dotenv").config();

const secret = process.env.QR_SECRET || "sua-chave-secreta";

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
    const qrRawData = {};
    for (const date of EVENT_DATES) {
      const baseData = {
        checkoutId,
        participantId: `${checkoutId}-${participantIndex}`,
        participantName: participant.name,
        eventName: EVENT_NAME,
        date,
      };
      const signature = crypto
        .createHmac("sha256", secret)
        .update(`${checkoutId}-${participantIndex}-${date}`)
        .digest("hex");
      const qrData = JSON.stringify({ ...baseData, signature });

      qrRawData[date] = qrData;
      qrCodes[date] = await QRCode.toDataURL(qrData);
    }

    participant.qrCodes = qrCodes;
    participant.qrRawData = qrRawData;
    participant.validated = { "2025-05-31": false, "2025-06-01": false };
    await updateDoc(checkoutRef, { participants: checkout.participants });

    sendResponse(
      res,
      200,
      true,
      "QR Codes gerados e enviados com sucesso",
      qrRawData
    );
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

module.exports = { generateQRCodesForParticipant };
