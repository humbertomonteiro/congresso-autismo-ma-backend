const { db } = require("./src/config").firebase;
const {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  limit,
} = require("firebase/firestore");
const EmailService = require("./src/services/EmailService");
const logger = require("./src/logger");
require("dotenv").config();

const EMAIL_FROM = process.env.EMAIL_USER_6;
const TEST_LIMIT = 2; // Processar apenas 2 checkouts para teste

async function testSendPendingEmails() {
  try {
    logger.info(
      `Iniciando teste de envio de emails para até ${TEST_LIMIT} checkouts...`
    );

    // Verificar se EMAIL_FROM é válido
    // const availableEmails = EmailService.getAvailableEmailAccounts();
    // if (!availableEmails.includes(EMAIL_FROM)) {
    //   throw new Error(
    //     `EMAIL_FROM (${EMAIL_FROM}) não está configurado em emailAccounts.`
    //   );
    // }

    // Buscar checkouts com qrCodesSent: false, limitado a TEST_LIMIT
    const checkoutsRef = collection(db, "checkouts");
    const q = query(
      checkoutsRef,
      where("qrCodesSent", "==", false),
      limit(TEST_LIMIT)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      logger.info("Nenhum checkout pendente encontrado para teste.");
      return;
    }

    logger.info(`Encontrados ${querySnapshot.size} checkouts para teste.`);

    let totalEmailsSent = 0;

    // Processar cada checkout
    for (const checkoutDoc of querySnapshot.docs) {
      const checkout = checkoutDoc.data();
      const checkoutId = checkoutDoc.id;
      logger.info(`Testando checkout ${checkoutId}...`);

      // Validar orderDetails
      if (!checkout.orderDetails) {
        logger.warn(`Checkout ${checkoutId} sem orderDetails. Pulando.`);
        continue;
      }

      // Verificar limites de envio
      const stats = await EmailService.getEmailStats();
      if (stats.available <= 0) {
        logger.warn("Limite diário de emails atingido. Encerrando teste.");
        return;
      }

      // Processar cada participante
      for (let i = 0; i < checkout.participants.length; i++) {
        const participant = checkout.participants[i];
        if (!participant.email || !participant.email.includes("@")) {
          logger.warn(
            `Email inválido no checkout ${checkoutId}, participante ${i}: ${participant.email}. Pulando.`
          );
          continue;
        }

        const emailData = {
          checkoutId,
          from: EMAIL_FROM,
          to: participant.email,
          subject:
            "Confirmação de Pagamento - Congresso Autismo MA 2025 (Teste)",
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
            `Enviando email de teste para ${participant.email} (participante ${i})...`
          );
          const emailResponse = await EmailService.sendEmailConfirmationPayment(
            emailData
          );
          if (emailResponse.success) {
            logger.info(
              `Email de teste enviado com sucesso para ${participant.email}.`
            );
            totalEmailsSent++;
          } else {
            logger.warn(
              `Email de teste não enviado para ${participant.email}: ${emailResponse.message}`
            );
          }
        } catch (error) {
          logger.error(
            `Erro ao enviar email de teste para ${participant.email}: ${error.message}`
          );
        }

        // Atraso para evitar sobrecarga
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Atualizar qrCodesSent para true (comentar se não quiser atualizar no teste)
      try {
        const checkoutRef = doc(db, "checkouts", checkoutId);
        await updateDoc(checkoutRef, { qrCodesSent: true });
        logger.info(
          `Checkout ${checkoutId} marcado como qrCodesSent: true (teste).`
        );
      } catch (error) {
        logger.error(
          `Erro ao atualizar checkout ${checkoutId}: ${error.message}`
        );
      }
    }

    logger.info(
      `Teste concluído. Total de emails enviados: ${totalEmailsSent}`
    );
  } catch (error) {
    logger.error(`Erro geral no teste de envio de emails: ${error.message}`);
  }
}

// Executar o script de teste
testSendPendingEmails().catch((error) => {
  logger.error(`Erro ao executar o script de teste: ${error.message}`);
  process.exit(1);
});
