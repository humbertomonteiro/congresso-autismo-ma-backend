const logger = require("../logger");
const nodemailer = require("nodemailer");
const EmailRepository = require("../repositories/EmailRepository");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const CredentialService = require("./CredentialService");
const fs = require("fs").promises;
const path = require("path");
const QRCode = require("qrcode");
const { generateTicketPDF } = require("../utils/templateUtils");
const {
  arrayRemove,
  arrayUnion,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} = require("firebase/firestore");
const { db } = require("../config").firebase;
require("dotenv").config();

const emailAccounts = [
  { user: process.env.EMAIL_USER_1, pass: process.env.EMAIL_PASS_1 },
  { user: process.env.EMAIL_USER_2, pass: process.env.EMAIL_PASS_2 },
  { user: process.env.EMAIL_USER_3, pass: process.env.EMAIL_PASS_3 },
  { user: process.env.EMAIL_USER_4, pass: process.env.EMAIL_PASS_4 },
  { user: process.env.EMAIL_USER_5, pass: process.env.EMAIL_PASS_5 },
  { user: process.env.EMAIL_USER_6, pass: process.env.EMAIL_PASS_6 },
  { user: process.env.EMAIL_USER_7, pass: process.env.EMAIL_PASS_7 },
].filter((acc) => acc.user && acc.pass);

class EmailService {
  constructor() {
    this.isProcessing = false;
    this.dailyLimitPerAccount = 400;
    this.totalDailyLimit = emailAccounts.length * this.dailyLimitPerAccount;
    this.newParticipantsReserve = 500;
    this.effectiveDailyLimit =
      this.totalDailyLimit - this.newParticipantsReserve;
  }

  async getEmailStats() {
    const today = new Date().toISOString().split("T")[0];
    const statsDocRef = doc(db, "emailStats", today);
    let stats = { totalSent: 0, lastUpdated: new Date().toISOString() };

    const docSnap = await getDoc(statsDocRef);
    if (docSnap.exists()) {
      stats = docSnap.data();
      logger.info(
        `Stats carregados do Firestore: totalSent=${stats.totalSent}`
      );
    } else {
      await setDoc(statsDocRef, {
        totalSent: 0,
        lastUpdated: new Date().toISOString(),
      });
      logger.info("Stats inicializados no Firestore: totalSent=0");
    }

    const totalSent = stats.totalSent || 0; // Garante que não seja undefined
    const available = this.totalDailyLimit - totalSent;
    const availableForTemplates = Math.max(
      0,
      available - this.newParticipantsReserve
    );

    logger.info(
      `Calculado: totalDailyLimit=${this.totalDailyLimit}, totalSent=${totalSent}, available=${available}, availableForTemplates=${availableForTemplates}`
    );

    return { totalSent, available, availableForTemplates };
  }

  async incrementEmailCount(count = 1) {
    const today = new Date().toISOString().split("T")[0];
    const statsDocRef = doc(db, "emailStats", today);

    const docSnap = await getDoc(statsDocRef);
    if (docSnap.exists()) {
      const currentStats = docSnap.data();
      await updateDoc(statsDocRef, {
        totalSent: currentStats.totalSent + count,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      await setDoc(statsDocRef, {
        totalSent: count,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  async sendEmail({ from, to, subject, html, attachments }) {
    const account = emailAccounts.find((acc) => acc.user === from);
    if (!account) throw new Error("Conta de email não configurada.");

    const stats = await this.getEmailStats();
    if (stats.available <= 0) {
      throw new Error("Limite diário total de emails atingido.");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: account.user, pass: account.pass },
    });

    const mailOptions = {
      from: account.user,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      attachments,
    };

    await new Promise((resolve) => setTimeout(resolve, 100));
    await transporter.sendMail(mailOptions);
    await this.incrementEmailCount(1);
    logger.info(
      `Email enviado de ${from} para ${to}. Total enviado hoje: ${
        stats.totalSent + 1
      }`
    );
  }

  async getAllTemplates() {
    try {
      const snapshot = await getDocs(collection(db, "emailTemplates"));
      const templates = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      logger.info(`Carregados ${templates.length} templates do Firestore`);
      return templates;
    } catch (error) {
      logger.error(`Erro ao buscar templates: ${error.message}`);
      throw new Error(`Erro ao buscar templates: ${error.message}`);
    }
  }

  async updateTemplate(templateId, templateData) {
    try {
      const templateRef = doc(db, "emailTemplates", templateId);
      await updateDoc(templateRef, templateData);
      logger.info(`Template ${templateId} atualizado com sucesso`);
    } catch (error) {
      logger.error(
        `Erro ao atualizar template ${templateId}: ${error.message}`
      );
      throw new Error(`Erro ao atualizar template: ${error.message}`);
    }
  }

  async deleteTemplate(templateId) {
    try {
      const templateRef = doc(db, "emailTemplates", templateId);
      await deleteDoc(templateRef);
      logger.info(`Template ${templateId} deletado com sucesso`);
    } catch (error) {
      logger.error(`Erro ao deletar template ${templateId}: ${error.message}`);
      throw new Error(`Erro ao deletar template: ${error.message}`);
    }
  }

  async createTemplateByStatus({
    subject,
    title,
    body,
    statusFilter,
    includeQRCodes = false,
  }) {
    const stats = await this.getEmailStats();
    const templates = await this.getAllTemplates();
    const sameStatusTemplates = templates.filter(
      (t) => t.statusFilter === statusFilter
    );
    const unfinishedTemplates = sameStatusTemplates.some(
      (t) => t.progress < 100
    );
    if (unfinishedTemplates) {
      throw new Error(
        `Finalize o envio do template anterior para "${statusFilter}" antes de criar outro.`
      );
    }

    const checkouts = await CheckoutRepository.fetchCheckouts({
      status: statusFilter,
    });
    const targetCount =
      statusFilter === "approved"
        ? checkouts.reduce((sum, c) => sum + c.participants.length, 0)
        : checkouts.length;
    if (targetCount > stats.availableForTemplates) {
      throw new Error(
        `Restam ${stats.availableForTemplates} emails para templates hoje. Não é possível enviar para ${targetCount} destinatários.`
      );
    }

    const templateData = {
      subject,
      title,
      body,
      statusFilter,
      includeQRCodes,
      totalTarget: targetCount,
      sentCount: 0,
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    const docRef = await addDoc(collection(db, "emailTemplates"), templateData);
    const templateId = docRef.id;
    logger.info(
      `Template ${templateId} criado para ${statusFilter} com alvo de ${targetCount} emails.`
    );

    for (const checkout of checkouts) {
      await CheckoutRepository.updateCheckout(checkout.id, {
        pendingEmails: arrayUnion(templateId),
      });
    }

    return { templateId };
  }

  // async sendEmailConfirmationPayment(emailData) {
  //   const { checkoutId, from, to, subject, participantIndex, data } = emailData;

  //   const stats = await this.getEmailStats();
  //   if (stats.available <= 0) {
  //     throw new Error("Limite diário total de emails atingido.");
  //   }

  //   const checkoutRef = doc(db, "checkouts", checkoutId);
  //   const checkoutSnap = await getDoc(checkoutRef);
  //   if (!checkoutSnap.exists()) {
  //     throw new Error(`Checkout ${checkoutId} não encontrado`);
  //   }
  //   const checkoutData = checkoutSnap.data();

  //   // Determina o participante a processar
  //   let participant;
  //   let participantIdx;

  //   if (
  //     participantIndex !== undefined &&
  //     participantIndex >= 0 &&
  //     participantIndex < checkoutData.participants.length
  //   ) {
  //     // Envio individual baseado no índice (usado no ModalCheckoutDetails)
  //     participant = checkoutData.participants[participantIndex];
  //     participantIdx = participantIndex;
  //     if (participant.email !== to) {
  //       logger.warn(
  //         `Email fornecido (${to}) não corresponde ao email do participante no índice ${participantIndex} (${participant.email})`
  //       );
  //     }
  //   } else {
  //     // Padrão: busca pelo email 'to' (compatível com usePaymentForm.js)
  //     participant = checkoutData.participants.find((p) => p.email === to);
  //     if (!participant) {
  //       throw new Error(
  //         `Participante com email ${to} não encontrado no checkout ${checkoutId}`
  //       );
  //     }
  //     participantIdx = checkoutData.participants.indexOf(participant);
  //   }

  //   // Verifica se o participante já tem QR codes (evita duplicatas)
  //   if (
  //     participant.qrRawData &&
  //     participant.qrRawData["2025-05-31"] &&
  //     participant.qrRawData["2025-06-01"]
  //   ) {
  //     logger.info(
  //       `Participante ${participant.email} (índice ${participantIdx}) já possui QR codes. Ignorando envio.`
  //     );
  //     return { success: false, message: "Participante já possui QR codes" };
  //   }

  //   // Gera dois QR codes para o participante
  //   const { qrCodes, qrRawData } =
  //     await CredentialService.generateQRCodesForParticipant(
  //       checkoutId,
  //       participantIdx,
  //       participant.name
  //     );

  //   // Gera o PDF com o nome do participante
  //   const pdfPath = await generateTicketPDF(
  //     { ...data, participantName: participant.name || "Participante" },
  //     qrCodes
  //   );
  //   const attachments = [
  //     {
  //       filename: `ingresso_${participant.name || "Participante"}.pdf`,
  //       path: pdfPath,
  //       contentType: "application/pdf",
  //     },
  //   ];

  //   // Construir o corpo do email com o template
  //   const templatePath = path.join(
  //     __dirname,
  //     "../templates/emailTemplate.html"
  //   );
  //   let htmlTemplate = await fs.readFile(templatePath, "utf-8");

  //   htmlTemplate = htmlTemplate
  //     .replace("{{nome}}", participant.name || "Participante")
  //     .replace("{{transactionId}}", data.transactionId || "N/A")
  //     .replace("{{fullTickets}}", data.fullTickets || 0)
  //     .replace("{{valueTicketsAll}}", data.valueTicketsAll || "0.00")
  //     .replace("{{halfTickets}}", data.halfTickets || 0)
  //     .replace("{{installments}}", data.installments || 1)
  //     .replace("{{valueTicketsHalf}}", data.valueTicketsHalf || "0.00")
  //     .replace("{{total}}", data.total || "0.00");

  //   if (data.discount && data.coupon) {
  //     htmlTemplate = htmlTemplate
  //       .replace("{{#if discount}}", "")
  //       .replace("{{/if}}", "")
  //       .replace("{{coupon}}", data.coupon)
  //       .replace("{{discount}}", data.discount);
  //   } else {
  //     htmlTemplate = htmlTemplate.replace(
  //       /{{#if discount}}[\s\S]*?{{\/if}}/g,
  //       ""
  //     );
  //   }

  //   // Envia o email
  //   await this.sendEmail({
  //     from,
  //     to: participant.email,
  //     subject,
  //     html: htmlTemplate,
  //     attachments,
  //   });

  //   await this.incrementEmailCount(1);
  //   logger.info(
  //     `Email de confirmação enviado para ${
  //       participant.email
  //     } (participante ${participantIdx}). Total enviado hoje: ${
  //       stats.totalSent + 1
  //     }`
  //   );

  //   // Salva os QR codes no Firebase
  //   await CheckoutRepository.updateParticipant(checkoutId, participantIdx, {
  //     qrRawData,
  //     validated: { "2025-05-31": false, "2025-06-01": false },
  //   });

  //   // Remove o PDF temporário
  //   await fs
  //     .unlink(pdfPath)
  //     .catch((err) =>
  //       console.error(`Erro ao remover ${pdfPath}: ${err.message}`)
  //     );

  //   return { success: true, message: "Email enviado com sucesso" };
  // }

  async sendEmailConfirmationPayment(emailData) {
    const { checkoutId, from, to, subject, participantIndex, data } = emailData;

    const stats = await this.getEmailStats();
    if (stats.available <= 0) {
      throw new Error("Limite diário total de emails atingido.");
    }

    const checkoutRef = doc(db, "checkouts", checkoutId);
    const checkoutSnap = await getDoc(checkoutRef);
    if (!checkoutSnap.exists()) {
      throw new Error(`Checkout ${checkoutId} não encontrado`);
    }
    const checkoutData = checkoutSnap.data();

    // Determina os participantes a processar
    let participantsToProcess = [];
    if (
      participantIndex !== undefined &&
      participantIndex >= 0 &&
      participantIndex < checkoutData.participants.length
    ) {
      // Envio individual baseado no índice
      const participant = checkoutData.participants[participantIndex];
      if (participant.email !== to) {
        logger.warn(
          `Email fornecido (${to}) não corresponde ao email do participante no índice ${participantIndex} (${participant.email})`
        );
      }
      participantsToProcess.push({
        participant,
        participantIdx: participantIndex,
      });
    } else {
      // Busca todos os participantes com o email 'to'
      checkoutData.participants.forEach((participant, idx) => {
        if (participant.email === to) {
          participantsToProcess.push({ participant, participantIdx: idx });
        }
      });
      if (participantsToProcess.length === 0) {
        throw new Error(
          `Nenhum participante com email ${to} encontrado no checkout ${checkoutId}`
        );
      }
    }

    const results = [];
    for (const { participant, participantIdx } of participantsToProcess) {
      // Verifica se o participante já tem QR codes
      if (
        participant.qrRawData &&
        participant.qrRawData["2025-05-31"] &&
        participant.qrRawData["2025-06-01"]
      ) {
        logger.info(
          `Participante ${participant.email} (índice ${participantIdx}) já possui QR codes. Ignorando envio.`
        );
        results.push({
          success: false,
          message: `Participante ${participant.name} já possui QR codes`,
          participantIdx,
        });
        continue;
      }

      // Gera dois QR codes para o participante
      const { qrCodes, qrRawData } =
        await CredentialService.generateQRCodesForParticipant(
          checkoutId,
          participantIdx,
          participant.name
        );

      // Gera o PDF com o nome do participante
      const pdfPath = await generateTicketPDF(
        { ...data, participantName: participant.name || "Participante" },
        qrCodes
      );
      const attachments = [
        {
          filename: `ingresso_${participant.name || "Participante"}.pdf`,
          path: pdfPath,
          contentType: "application/pdf",
        },
      ];

      // Construir o corpo do email com o template
      const templatePath = path.join(
        __dirname,
        "../templates/emailTemplate.html"
      );
      let htmlTemplate = await fs.readFile(templatePath, "utf-8");

      htmlTemplate = htmlTemplate
        .replace("{{nome}}", participant.name || "Participante")
        .replace("{{transactionId}}", data.transactionId || "N/A")
        .replace("{{fullTickets}}", data.fullTickets || 0)
        .replace("{{valueTicketsAll}}", data.valueTicketsAll || "0.00")
        .replace("{{halfTickets}}", data.halfTickets || 0)
        .replace("{{installments}}", data.installments || 1)
        .replace("{{valueTicketsHalf}}", data.valueTicketsHalf || "0.00")
        .replace("{{total}}", data.total || "0.00");

      if (data.discount && data.coupon) {
        htmlTemplate = htmlTemplate
          .replace("{{#if discount}}", "")
          .replace("{{/if}}", "")
          .replace("{{coupon}}", data.coupon)
          .replace("{{discount}}", data.discount);
      } else {
        htmlTemplate = htmlTemplate.replace(
          /{{#if discount}}[\s\S]*?{{\/if}}/g,
          ""
        );
      }

      // Envia o email
      await this.sendEmail({
        from,
        to: participant.email,
        subject,
        html: htmlTemplate,
        attachments,
      });

      await this.incrementEmailCount(1);
      logger.info(
        `Email de confirmação enviado para ${
          participant.email
        } (participante ${participantIdx}). Total enviado hoje: ${
          stats.totalSent + results.length + 1
        }`
      );

      // Salva os QR codes no Firebase
      await CheckoutRepository.updateParticipant(checkoutId, participantIdx, {
        qrRawData,
        validated: { "2025-05-31": false, "2025-06-01": false },
      });

      // Remove o PDF temporário
      await fs
        .unlink(pdfPath)
        .catch((err) =>
          console.error(`Erro ao remover ${pdfPath}: ${err.message}`)
        );

      results.push({
        success: true,
        message: `Email enviado com sucesso para ${participant.name}`,
        participantIdx,
      });
    }

    return results.length === 1
      ? results[0]
      : { success: true, message: "Emails enviados com sucesso", results };
  }

  // async processAutomaticEmails(templateIds = null) {
  //   if (this.isProcessing) {
  //     logger.info("Processamento já em andamento, ignorando.");
  //     return;
  //   }

  //   this.isProcessing = true;
  //   logger.info("Processando emails automáticos...");

  //   try {
  //     const stats = await this.getEmailStats();
  //     const templates = await this.getAllTemplates();
  //     const filteredTemplates = templateIds
  //       ? templates.filter((t) => t.statusFilter && templateIds.includes(t.id))
  //       : templates.filter((t) => t.statusFilter && t.progress < 100);

  //     const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  //     const batchSize = 50;
  //     let accountIndex = 0;

  //     for (const template of filteredTemplates) {
  //       const checkouts =
  //         await CheckoutRepository.fetchCheckoutsNeedingTemplate(template.id);
  //       if (checkouts.length === 0) {
  //         logger.info(`Nenhum checkout pendente para ${template.id}`);
  //         continue;
  //       }

  //       const recipients = checkouts.map((c) => ({
  //         email: c.participants[0].email,
  //         checkoutId: c.id,
  //         participantName: c.participants[0].name,
  //         participantIndex: 0,
  //         allParticipants:
  //           template.statusFilter === "approved"
  //             ? c.participants
  //             : [c.participants[0]],
  //       }));

  //       for (let i = 0; i < recipients.length; i += batchSize) {
  //         const batch = recipients.slice(i, i + batchSize);
  //         const remainingEmails = stats.available - stats.totalSent;
  //         if (batch.length > remainingEmails) {
  //           logger.info(
  //             `Não há emails suficientes para o batch. Restam: ${remainingEmails}`
  //           );
  //           break;
  //         }

  //         const account = emailAccounts[accountIndex % emailAccounts.length];
  //         const templatePath = path.join(
  //           __dirname,
  //           "../templates/emailTemplateSimple.html"
  //         );
  //         const htmlTemplate = await fs.readFile(templatePath, "utf-8");

  //         for (const recipient of batch) {
  //           const participantsToSend = recipient.allParticipants;
  //           for (const participant of participantsToSend) {
  //             const currentStats = await this.getEmailStats();
  //             if (currentStats.available <= 0) {
  //               logger.info("Limite diário atingido durante o processamento.");
  //               return;
  //             }

  //             let html = htmlTemplate
  //               .replace(/{{nome}}/g, participant.name || "Participante")
  //               .replace(/{{title}}/g, template.title || "")
  //               .replace(/{{body}}/g, template.body || "")
  //               .replace(/{{subject}}/g, template.subject || "");

  //             let attachments = [];
  //             if (template.includeQRCodes) {
  //               const participantIndex =
  //                 recipient.allParticipants.indexOf(participant);
  //               const { qrCodes, qrRawData } =
  //                 await CredentialService.generateQRCodesForParticipant(
  //                   recipient.checkoutId,
  //                   participantIndex,
  //                   participant.name
  //                 );
  //               const pdfPath = await generateTicketPDF(
  //                 {
  //                   checkoutId: recipient.checkoutId,
  //                   participantName: participant.name,
  //                 },
  //                 qrCodes
  //               );
  //               attachments.push({
  //                 filename: `ingresso_${participant.name}.pdf`,
  //                 path: pdfPath,
  //                 contentType: "application/pdf",
  //               });
  //               await CheckoutRepository.updateParticipant(
  //                 recipient.checkoutId,
  //                 participantIndex,
  //                 {
  //                   qrRawData,
  //                   validated: { "2025-05-31": false, "2025-06-01": false },
  //                 }
  //               );
  //             }

  //             await this.sendEmail({
  //               from: account.user,
  //               to: participant.email,
  //               subject: template.subject,
  //               html,
  //               attachments,
  //             });

  //             template.sentCount = (template.sentCount || 0) + 1;
  //             template.progress = Math.round(
  //               (template.sentCount / template.totalTarget) * 100
  //             );
  //             await this.updateTemplate(template.id, {
  //               sentCount: template.sentCount,
  //               progress: template.progress,
  //             });

  //             if (attachments.length > 0) {
  //               await fs
  //                 .unlink(attachments[0].path)
  //                 .catch((err) =>
  //                   logger.error(
  //                     `Erro ao remover ${attachments[0].path}: ${err.message}`
  //                   )
  //                 );
  //             }
  //           }

  //           await CheckoutRepository.updateCheckout(recipient.checkoutId, {
  //             pendingEmails: arrayRemove(template.id),
  //             sentEmails: arrayUnion(template.id),
  //           });
  //         }

  //         await delay(5000);
  //         accountIndex++;
  //       }
  //     }
  //   } catch (error) {
  //     logger.error(`Erro ao processar emails automáticos: ${error.message}`);
  //     throw error;
  //   } finally {
  //     this.isProcessing = false;
  //     logger.info("Processamento concluído.");
  //   }
  // }
  async processAutomaticEmails(templateIds = null) {
    if (this.isProcessing) {
      logger.info("Processamento já em andamento, ignorando.");
      return;
    }

    this.isProcessing = true;
    logger.info("Iniciando processamento de e-mails automáticos");

    try {
      const stats = await this.getEmailStats();
      logger.info(`Estatísticas de e-mail: ${JSON.stringify(stats)}`);
      const templates = await this.getAllTemplates();
      logger.info(`Total de templates carregados: ${templates.length}`);
      const filteredTemplates = templateIds
        ? templates.filter((t) => t.statusFilter && templateIds.includes(t.id))
        : templates.filter((t) => t.statusFilter && t.progress < 100);
      logger.info(
        `Templates a processar: ${filteredTemplates
          .map((t) => t.id)
          .join(", ")}`
      );

      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const batchSize = 50;
      let accountIndex = 0;

      for (const template of filteredTemplates) {
        logger.info(
          `Processando template ${template.id} com statusFilter ${template.statusFilter}, includeQRCodes: ${template.includeQRCodes}`
        );
        const checkouts =
          await CheckoutRepository.fetchCheckoutsNeedingTemplate(template.id);
        logger.info(
          `Checkouts pendentes para template ${template.id}: ${checkouts.length}`
        );
        if (checkouts.length === 0) {
          logger.info(`Nenhum checkout pendente para ${template.id}`);
          continue;
        }

        const recipients = [];
        for (const checkout of checkouts) {
          const participantsToSend = checkout.participants;
          logger.info(
            `Checkout ${checkout.id} tem ${participantsToSend.length} participantes para enviar`
          );
          participantsToSend.forEach((participant, participantIndex) => {
            recipients.push({
              email: participant.email,
              checkoutId: checkout.id,
              participantName: participant.name,
              participantIndex,
              allParticipants: participantsToSend,
            });
          });
        }
        logger.info(
          `Total de destinatários para template ${template.id}: ${recipients.length}`
        );

        for (let i = 0; i < recipients.length; i += batchSize) {
          const batch = recipients.slice(i, i + batchSize);
          logger.info(`Processando lote de ${batch.length} destinatários`);
          const currentStats = await this.getEmailStats();
          const remainingEmails = currentStats.available;
          if (batch.length > remainingEmails) {
            logger.error(
              `Não há e-mails suficientes para o lote. Restam: ${remainingEmails}`
            );
            break;
          }

          const account = emailAccounts[accountIndex % emailAccounts.length];
          logger.info(`Usando conta de e-mail: ${account.user}`);
          const templatePath = path.join(
            __dirname,
            "../templates/emailTemplateSimple.html"
          );
          const htmlTemplate = await fs.readFile(templatePath, "utf-8");
          logger.info(`Template HTML carregado de: ${templatePath}`);

          for (const recipient of batch) {
            logger.info(`Estatísticas atuais: ${JSON.stringify(currentStats)}`);
            if (currentStats.available <= 0) {
              logger.error("Limite diário atingido durante o processamento");
              return;
            }

            const participant =
              recipient.allParticipants[recipient.participantIndex];
            logger.info(
              `Processando e-mail para ${participant.email} (índice ${recipient.participantIndex})`
            );

            let html = htmlTemplate
              .replace(/{{nome}}/g, participant.name || "Participante")
              .replace(/{{title}}/g, template.title || "")
              .replace(/{{body}}/g, template.body || "")
              .replace(/{{subject}}/g, template.subject || "");

            let attachments = [];
            if (template.includeQRCodes) {
              logger.info(`Preparando QR codes para ${participant.email}`);
              let qrCodesData = [];

              if (
                participant.qrRawData &&
                participant.qrRawData["2025-05-31"] &&
                participant.qrRawData["2025-06-01"]
              ) {
                logger.info(
                  `Usando QR codes existentes para ${participant.email}`
                );

                try {
                  const qrCode1 = await QRCode.toDataURL(
                    participant.qrRawData["2025-05-31"]
                  );
                  const qrCode2 = await QRCode.toDataURL(
                    participant.qrRawData["2025-06-01"]
                  );
                  qrCodesData = [qrCode1, qrCode2];
                  logger.info(
                    `QR codes convertidos para imagens: ${participant.email}`
                  );
                } catch (error) {
                  logger.error(
                    `Erro ao gerar QR codes a partir dos dados existentes: ${error.message}`
                  );
                  throw error;
                }
                // qrCodesData = [
                //   participant.qrRawData["2025-05-31"],
                //   participant.qrRawData["2025-06-01"],
                // ];
                // logger.info(
                //   `Dados de QR Code preparados para ${participant.email}`
                // );
              } else {
                logger.info(`Gerando novos QR codes para ${participant.email}`);
                try {
                  const result =
                    await CredentialService.generateQRCodesForParticipant(
                      recipient.checkoutId,
                      recipient.participantIndex,
                      participant.name
                    );
                  qrCodesData = [
                    result.qrCodes[0], // Usar as imagens geradas diretamente
                    result.qrCodes[1],
                  ];
                  await CheckoutRepository.updateParticipant(
                    recipient.checkoutId,
                    recipient.participantIndex,
                    {
                      qrRawData: result.qrRawData,
                      validated: { "2025-05-31": false, "2025-06-01": false },
                    }
                  );
                } catch (error) {
                  logger.error(`Erro ao gerar QR codes: ${error.message}`);
                  throw error;
                }
              }

              try {
                const safeParticipantName = (
                  participant.name || "Participante"
                ).replace(/\s/g, "_");
                logger.info(
                  `Gerando PDF para ${participant.email} com ${qrCodesData.length} QR codes`
                );
                const pdfPath = await generateTicketPDF(
                  {
                    checkoutId: recipient.checkoutId,
                    participantName: safeParticipantName,
                  },
                  qrCodesData
                );
                logger.info(`PDF gerado em: ${pdfPath}`);
                attachments.push({
                  filename: `ingresso_${safeParticipantName}.pdf`,
                  path: pdfPath,
                  contentType: "application/pdf",
                });
              } catch (error) {
                logger.error(
                  `Erro ao gerar PDF para ${participant.email}: ${error.message}`
                );
                throw error;
              }
            }

            try {
              await this.sendEmail({
                from: account.user,
                to: participant.email,
                subject: template.subject,
                html,
                attachments,
              });
              logger.info(`E-mail enviado para ${participant.email}`);
            } catch (error) {
              logger.error(
                `Erro ao enviar e-mail para ${participant.email}: ${error.message}`
              );
              throw error;
            }

            template.sentCount = (template.sentCount || 0) + 1;
            template.progress = Math.round(
              (template.sentCount / template.totalTarget) * 100
            );
            await this.updateTemplate(template.id, {
              sentCount: template.sentCount,
              progress: template.progress,
            });
            logger.info(
              `Template ${template.id} atualizado: sentCount=${template.sentCount}, progress=${template.progress}`
            );

            if (attachments.length > 0) {
              await fs
                .unlink(attachments[0].path)
                .catch((err) =>
                  logger.error(
                    `Erro ao remover ${attachments[0].path}: ${err.message}`
                  )
                );
              logger.info(`PDF temporário removido: ${attachments[0].path}`);
            }

            if (
              recipient.participantIndex ===
              recipient.allParticipants.length - 1
            ) {
              await CheckoutRepository.updateCheckout(recipient.checkoutId, {
                pendingEmails: arrayRemove(template.id),
                sentEmails: arrayUnion(template.id),
              });
              logger.info(
                `Checkout ${recipient.checkoutId} atualizado: template ${template.id} movido de pendingEmails para sentEmails`
              );
            }
          }

          await delay(5000);
          logger.info(`Aguardando 5 segundos antes do próximo lote`);
          accountIndex++;
        }
      }
    } catch (error) {
      logger.error(`Erro ao processar e-mails automáticos: ${error.message}`);
      throw error;
    } finally {
      this.isProcessing = false;
      logger.info("Processamento de e-mails automáticos concluído");
    }
  }
}

module.exports = new EmailService();
