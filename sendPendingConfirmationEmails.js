const { db } = require("./src/config").firebase;
const {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} = require("firebase/firestore");
const EmailService = require("./src/services/EmailService");
const logger = require("./src/logger");
require("dotenv").config();

const EMAIL_FROM = process.env.EMAIL_USER_7;

async function sendPendingConfirmationEmails() {
  try {
    logger.info("Iniciando envio de emails de confirmação pendentes...");

    // Buscar checkouts com qrCodesSent: false
    const checkoutsRef = collection(db, "checkouts");
    const q = query(checkoutsRef, where("qrCodesSent", "==", false));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      logger.info(
        "Nenhum checkout pendente encontrado com qrCodesSent: false."
      );
      return;
    }

    logger.info(`Encontrados ${querySnapshot.size} checkouts pendentes.`);

    // Processar cada checkout
    for (const checkoutDoc of querySnapshot.docs) {
      const checkout = checkoutDoc.data();
      const checkoutId = checkoutDoc.id;
      logger.info(`Processando checkout ${checkoutId}...`);

      // Verificar limites de envio
      const stats = await EmailService.getEmailStats();
      if (stats.available <= 0) {
        logger.warn("Limite diário de emails atingido. Encerrando.");
        return;
      }

      // Processar cada participante
      for (let i = 0; i < checkout.participants.length; i++) {
        const participant = checkout.participants[i];
        const emailData = {
          checkoutId,
          from: EMAIL_FROM,
          to: participant.email,
          subject: "Confirmação de Pagamento - Congresso Autismo MA 2026",
          participantIndex: i,
          data: {
            name: participant.name || "Participante",
            transactionId: checkout.transactionId || "N/A",
            fullTickets: checkout.orderDetails?.fullTickets || 0,
            valueTicketsAll: checkout.orderDetails?.valueTicketsAll || "0.00",
            halfTickets: checkout.orderDetails?.halfTickets || 0,
            valueTicketsHalf: checkout.orderDetails?.valueTicketsHalf || "0.00",
            coupon: checkout.orderDetails?.coupon || "",
            discount: checkout.orderDetails?.discount || "0.00",
            total: checkout.orderDetails?.total || "0.00",
            installments: checkout.orderDetails?.installments || 1,
          },
        };

        try {
          logger.info(
            `Enviando email para ${participant.email} (participante ${i})...`
          );
          const emailResponse = await EmailService.sendEmailConfirmationPayment(
            emailData
          );
          if (emailResponse.success) {
            logger.info(`Email enviado com sucesso para ${participant.email}.`);
          } else {
            logger.warn(
              `Email não enviado para ${participant.email}: ${emailResponse.message}`
            );
          }
        } catch (error) {
          logger.error(
            `Erro ao enviar email para ${participant.email}: ${error.message}`
          );
        }

        // Pequeno atraso para evitar sobrecarga no Gmail
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Atualizar qrCodesSent para true
      try {
        const checkoutRef = doc(db, "checkouts", checkoutId);
        await updateDoc(checkoutRef, { qrCodesSent: true });
        logger.info(`Checkout ${checkoutId} marcado como qrCodesSent: true.`);
      } catch (error) {
        logger.error(
          `Erro ao atualizar checkout ${checkoutId}: ${error.message}`
        );
      }
    }

    logger.info("Envio de emails pendentes concluído.");
  } catch (error) {
    logger.error(`Erro geral no envio de emails pendentes: ${error.message}`);
  }
}

// Executar o script
sendPendingConfirmationEmails().catch((error) => {
  logger.error(`Erro ao executar o script: ${error.message}`);
  process.exit(1);
});
