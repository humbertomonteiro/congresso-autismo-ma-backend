// backend/src/services/credentialService.js
const QRCode = require("qrcode");

async function generateQRCodesForParticipant(checkoutId, participantIndex) {
  const dates = ["2025-05-31", "2025-06-01"];
  const qrCodes = {};

  for (const date of dates) {
    const qrCodeData = `${checkoutId}-${participantIndex}-${date}`;
    const qrCodeBuffer = await QRCode.toBuffer(qrCodeData, { width: 200 });
    qrCodes[date] = qrCodeBuffer;
  }

  return qrCodes;
}

module.exports = { generateQRCodesForParticipant };
