// src/services/CredentialService.js
const config = require("../config"); // Ajustado para nova estrutura
const { doc, getDoc, updateDoc } = require("firebase/firestore");
const QRCode = require("qrcode");
const crypto = require("crypto");
const dotenv = require("dotenv");

// Carrega variáveis de ambiente
dotenv.config();

const secret = process.env.QR_SECRET;
const EVENT_NAME = "Congresso Autismo MA 2026";
const EVENT_DATES = ["2026-05-31", "2026-06-01"];

class CredentialService {
  async generateQRCodesForParticipant(
    checkoutId,
    participantIndex,
    participantName
  ) {
    try {
      const checkoutRef = doc(config.firebase.db, "checkouts", checkoutId);
      const checkoutSnap = await getDoc(checkoutRef);
      if (!checkoutSnap.exists()) {
        throw new Error("Checkout não encontrado.");
      }

      const checkout = checkoutSnap.data();
      const participant = checkout.participants[participantIndex];
      if (!participant || participant.name !== participantName) {
        throw new Error(
          "Participante não encontrado ou nome inválido no checkout."
        );
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
      participant.validated = { "2026-05-31": false, "2026-06-01": false };
      await updateDoc(checkoutRef, { participants: checkout.participants });

      return { qrCodes, qrRawData };
    } catch (error) {
      console.error("Erro ao gerar QR Codes no serviço:", error.message);
      throw error;
    }
  }

  async validateQRCode(qrData) {
    try {
      let parsedData;
      try {
        parsedData = JSON.parse(qrData);
        console.log("Dados parseados:", parsedData);
      } catch (parseError) {
        console.error("Erro ao parsear qrData:", parseError.message);
        throw new Error("Formato de QR Code inválido");
      }

      const { checkoutId, participantId, date, signature } = parsedData;
      console.log("Chave secreta usada:", secret);
      // console.log("Dados parseados:", {
      //   checkoutId,
      //   participantId,
      //   date,
      //   signature,
      // });

      // const expectedSignature = crypto
      //   .createHmac("sha256", secret)
      //   .update(`${checkoutId}-${participantId.split("-")[1]}-${date}`)
      //   .digest("hex");

      // console.log("Assinatura recebida:", signature);
      // console.log("Assinatura esperada:", expectedSignature);
      // if (signature !== expectedSignature) {
      //   throw new Error("Assinatura inválida no QR Code.");
      // }

      const checkoutRef = doc(config.firebase.db, "checkouts", checkoutId);
      const checkoutSnap = await getDoc(checkoutRef);
      if (!checkoutSnap.exists()) {
        throw new Error("Checkout não encontrado.");
      }

      const checkout = checkoutSnap.data();
      const participantIndex = parseInt(participantId.split("-")[1], 10);
      const participant = checkout.participants[participantIndex];
      console.log("Dados do participante:", participant);

      if (
        !participant ||
        !participant.qrRawData ||
        !participant.qrRawData[date]
      ) {
        throw new Error("QR Code inválido ou não encontrado.");
      }

      const storedData = JSON.parse(participant.qrRawData[date]);
      const isValid =
        storedData.checkoutId === parsedData.checkoutId &&
        storedData.participantId === parsedData.participantId &&
        storedData.participantName === parsedData.participantName &&
        storedData.eventName === parsedData.eventName &&
        storedData.date === parsedData.date &&
        storedData.signature === parsedData.signature;

      if (!isValid) {
        console.log("QR esperado:", storedData);
        console.log("QR recebido:", parsedData);
        throw new Error("QR Code inválido.");
      }

      if (participant.validated[date]) {
        throw new Error("QR Code já validado para este dia.");
      }

      participant.validated[date] = true;
      const validationLogKey = `validationLog.${participantId}.${date}`;
      await updateDoc(checkoutRef, {
        participants: checkout.participants,
        [validationLogKey]: new Date().toISOString(),
      });

      return { isValid: true };
    } catch (error) {
      console.error("Erro ao validar QR Code no serviço:", error.message);
      throw error;
    }
  }
}

module.exports = new CredentialService();
