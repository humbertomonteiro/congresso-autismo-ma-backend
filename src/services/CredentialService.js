// // src/services/CredentialService.js
// const { doc, getDoc, updateDoc } = require("firebase/firestore");
// const QRCode = require("qrcode");
// const crypto = require("crypto");
// const dotenv = require("dotenv");

// // Carrega variáveis de ambiente
// dotenv.config();

// const secret = process.env.QR_SECRET;
// const config = require("../config");
// const EVENT_NAME = config.event.name;
// const EVENT_DATES = config.event.dates;

// class CredentialService {
//   async generateQRCodesForParticipant(
//     checkoutId,
//     participantIndex,
//     participantName
//   ) {
//     try {
//       const checkoutRef = doc(config.firebase.db, "checkouts", checkoutId);
//       const checkoutSnap = await getDoc(checkoutRef);
//       if (!checkoutSnap.exists()) {
//         throw new Error("Checkout não encontrado.");
//       }

//       const checkout = checkoutSnap.data();
//       const participant = checkout.participants[participantIndex];
//       if (!participant || participant.name !== participantName) {
//         throw new Error(
//           "Participante não encontrado ou nome inválido no checkout."
//         );
//       }

//       const qrCodes = {};
//       const qrRawData = {};
//       for (const date of EVENT_DATES) {
//         const baseData = {
//           checkoutId,
//           participantId: `${checkoutId}-${participantIndex}`,
//           participantName: participant.name,
//           eventName: EVENT_NAME,
//           date,
//         };
//         const signature = crypto
//           .createHmac("sha256", secret)
//           .update(`${checkoutId}-${participantIndex}-${date}`)
//           .digest("hex");
//         const qrData = JSON.stringify({ ...baseData, signature });

//         qrRawData[date] = qrData;
//         qrCodes[date] = await QRCode.toDataURL(qrData);
//       }

//       participant.qrCodes = qrCodes;
//       participant.qrRawData = qrRawData;
//       participant.validated = { "2026-05-16": false, "2026-05-17": false };
//       await updateDoc(checkoutRef, { participants: checkout.participants });

//       return { qrCodes, qrRawData };
//     } catch (error) {
//       console.error("Erro ao gerar QR Codes no serviço:", error.message);
//       throw error;
//     }
//   }

//   async validateQRCode(qrData) {
//     try {
//       let parsedData;
//       try {
//         parsedData = JSON.parse(qrData);
//         console.log("Dados parseados:", parsedData);
//       } catch (parseError) {
//         console.error("Erro ao parsear qrData:", parseError.message);
//         throw new Error("Formato de QR Code inválido");
//       }

//       const { checkoutId, participantId, date, signature } = parsedData;
//       console.log("Chave secreta usada:", secret);
//       // console.log("Dados parseados:", {
//       //   checkoutId,
//       //   participantId,
//       //   date,
//       //   signature,
//       // });

//       // const expectedSignature = crypto
//       //   .createHmac("sha256", secret)
//       //   .update(`${checkoutId}-${participantId.split("-")[1]}-${date}`)
//       //   .digest("hex");

//       // console.log("Assinatura recebida:", signature);
//       // console.log("Assinatura esperada:", expectedSignature);
//       // if (signature !== expectedSignature) {
//       //   throw new Error("Assinatura inválida no QR Code.");
//       // }

//       const checkoutRef = doc(config.firebase.db, "checkouts", checkoutId);
//       const checkoutSnap = await getDoc(checkoutRef);
//       if (!checkoutSnap.exists()) {
//         throw new Error("Checkout não encontrado.");
//       }

//       const checkout = checkoutSnap.data();
//       const participantIndex = parseInt(participantId.split("-")[1], 10);
//       const participant = checkout.participants[participantIndex];
//       console.log("Dados do participante:", participant);

//       if (
//         !participant ||
//         !participant.qrRawData ||
//         !participant.qrRawData[date]
//       ) {
//         throw new Error("QR Code inválido ou não encontrado.");
//       }

//       const storedData = JSON.parse(participant.qrRawData[date]);
//       const isValid =
//         storedData.checkoutId === parsedData.checkoutId &&
//         storedData.participantId === parsedData.participantId &&
//         storedData.participantName === parsedData.participantName &&
//         storedData.eventName === parsedData.eventName &&
//         storedData.date === parsedData.date &&
//         storedData.signature === parsedData.signature;

//       if (!isValid) {
//         console.log("QR esperado:", storedData);
//         console.log("QR recebido:", parsedData);
//         throw new Error("QR Code inválido.");
//       }

//       if (participant.validated[date]) {
//         throw new Error("QR Code já validado para este dia.");
//       }

//       participant.validated[date] = true;
//       const validationLogKey = `validationLog.${participantId}.${date}`;
//       await updateDoc(checkoutRef, {
//         participants: checkout.participants,
//         [validationLogKey]: new Date().toISOString(),
//       });

//       return { isValid: true };
//     } catch (error) {
//       console.error("Erro ao validar QR Code no serviço:", error.message);
//       throw error;
//     }
//   }
// }

// module.exports = new CredentialService();
const { db, admin } = require("../config").firebase;
const CheckoutRepository = require("../repositories/CheckoutRepository");
const QRCode = require("qrcode");
const crypto = require("crypto");
const config = require("../config");
const logger = require("../logger");

const secret = process.env.QR_SECRET;
const EVENT_NAME = config.event.name;
const EVENT_DATES = config.event.dates;

class CredentialService {
  // Gera um qrToken único e assinado para o participante
  // O token é autocontido: carrega tudo que o scanner precisa para validar offline
  _buildQrToken(checkoutId, participantId, participantName) {
    const payload = {
      checkoutId,
      participantId,
      participantName,
      eventName: EVENT_NAME,
      // Não coloca as datas aqui — o scanner valida pelo token, não pela data embutida
    };
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${checkoutId}-${participantId}`)
      .digest("hex");

    return JSON.stringify({ ...payload, signature });
  }

  _verifySignature(checkoutId, participantId, signature) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${checkoutId}-${participantId}`)
      .digest("hex");
    return expected === signature;
  }

  // Gera o qrToken e salva no participante (subcoleção)
  async generateQRCodesForParticipant(
    checkoutId,
    participantId,
    participantName
  ) {
    try {
      const participant = await CheckoutRepository.getParticipantById(
        checkoutId,
        participantId
      );

      if (participant.qrToken) {
        // Já tem token — só gera as imagens QR para cada data do evento
        const qrCodes = await this._generateQrImages(participant.qrToken);
        return { qrCodes, qrToken: participant.qrToken };
      }

      const qrToken = this._buildQrToken(
        checkoutId,
        participantId,
        participantName
      );

      // Salva o token no participante
      await CheckoutRepository.updateParticipant(checkoutId, participantId, {
        qrToken,
        checkedIn: false,
        checkedInAt: null,
      });

      const qrCodes = await this._generateQrImages(qrToken);
      logger.info(
        `[CredentialService] QR Token gerado para participante ${participantId}`
      );

      return { qrCodes, qrToken };
    } catch (error) {
      logger.error(`[CredentialService] Erro ao gerar QR: ${error.message}`);
      throw error;
    }
  }

  // Gera uma imagem QR para cada data do evento (para o PDF do ingresso)
  async _generateQrImages(qrToken) {
    const qrCodes = {};
    for (const date of EVENT_DATES) {
      // Embute a data no QR para o scanner saber qual dia está validando
      const dataWithDate = JSON.stringify({ ...JSON.parse(qrToken), date });
      qrCodes[date] = await QRCode.toDataURL(dataWithDate);
    }
    return qrCodes;
  }

  // Valida um QR Code escaneado no dia do evento
  async validateQRCode(qrData) {
    try {
      let parsedData;
      try {
        parsedData = JSON.parse(qrData);
      } catch {
        throw new Error("Formato de QR Code inválido.");
      }

      const { checkoutId, participantId, date, signature } = parsedData;

      if (!checkoutId || !participantId || !date || !signature) {
        throw new Error("QR Code incompleto.");
      }

      // Verifica a assinatura criptográfica
      if (!this._verifySignature(checkoutId, participantId, signature)) {
        throw new Error("QR Code com assinatura inválida.");
      }

      // Verifica se a data escaneada é válida para o evento
      if (!EVENT_DATES.includes(date)) {
        throw new Error(`Data ${date} não é válida para este evento.`);
      }

      // Busca o participante na subcoleção
      const participant = await CheckoutRepository.getParticipantById(
        checkoutId,
        participantId
      );

      if (!participant.qrToken) {
        throw new Error("Participante sem QR Code gerado.");
      }

      // Verifica se já fez check-in hoje
      const checkedInDates = participant.checkedInDates || {};
      if (checkedInDates[date]) {
        return {
          isValid: false,
          alreadyCheckedIn: true,
          message: `Participante já fez check-in em ${date}.`,
          participant: {
            name: participant.name,
            email: participant.email,
          },
        };
      }

      // Marca check-in
      const updatedDates = {
        ...checkedInDates,
        [date]: new Date().toISOString(),
      };
      await CheckoutRepository.updateParticipant(checkoutId, participantId, {
        checkedIn: true,
        checkedInAt: updatedDates[date],
        checkedInDates: updatedDates,
      });

      logger.info(
        `[CredentialService] Check-in: ${participant.name} em ${date}`
      );

      return {
        isValid: true,
        alreadyCheckedIn: false,
        message: `Check-in realizado com sucesso para ${date}.`,
        participant: {
          name: participant.name,
          email: participant.email,
        },
      };
    } catch (error) {
      logger.error(`[CredentialService] Erro ao validar QR: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new CredentialService();
