// backend/src/services/CredentialService.js
const { db } = require("../config");
const { doc, getDoc, updateDoc } = require("firebase/firestore");
const QRCode = require("qrcode");
const emailService = require("./emailService");

class CredentialService {
  async generateQRCodesForParticipant(checkoutId, participantIndex) {
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
    for (const date of ["2025-05-31", "2025-06-01"]) {
      const qrData = JSON.stringify({
        checkoutId,
        participantId: `${checkoutId}-${participantIndex}`,
        participantName: participant.name,
        eventName: "Congresso Autismo MA 2025",
        date,
      });
      qrCodes[date] = await QRCode.toDataURL(qrData);
    }

    participant.qrCodes = qrCodes;
    await updateDoc(checkoutRef, { participants: checkout.participants });

    await emailService.sendEmail({
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
    });

    return qrCodes;
  }

  async validateQRCode(qrData) {
    const parsedData = JSON.parse(qrData);
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

    return participant.qrCodes[date] === qrData;
  }
}

module.exports = new CredentialService();
