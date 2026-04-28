const { Resend } = require("resend");
const { db, admin } = require("../config").firebase;
const CheckoutRepository = require("../repositories/CheckoutRepository");
const CredentialService = require("./CredentialService");
const config = require("../config");
const logger = require("../logger");
const fs = require("fs").promises;
const path = require("path");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM;

class EmailService {
  constructor() {
    this.isProcessing = false;
    this.dailyLimit = 3000;
  }

  // ── Estatísticas diárias ──────────────────────────────────────────────────

  async getEmailStats() {
    const today = new Date().toISOString().split("T")[0];
    const ref = db.collection("emailStats").doc(today);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({ totalSent: 0, updatedAt: new Date().toISOString() });
      return { totalSent: 0, available: this.dailyLimit };
    }

    const { totalSent = 0 } = snap.data();
    return { totalSent, available: this.dailyLimit - totalSent };
  }

  async incrementEmailCount(count = 1) {
    const today = new Date().toISOString().split("T")[0];
    const ref = db.collection("emailStats").doc(today);
    // FieldValue.increment é atômico — sem race condition
    await ref.set(
      {
        totalSent: admin.firestore.FieldValue.increment(count),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  // ── Envio único via Resend ────────────────────────────────────────────────

  async sendEmail({ to, subject, html, attachments = [] }) {
    const stats = await this.getEmailStats();
    if (stats.available <= 0) {
      throw new Error("Limite diário de emails atingido.");
    }

    // Converte attachments no formato do Resend
    const resendAttachments = await Promise.all(
      attachments.map(async (att) => {
        if (att.path) {
          const content = await fs.readFile(att.path);
          return { filename: att.filename, content };
        }
        return { filename: att.filename, content: att.content };
      })
    );

    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      attachments: resendAttachments.length > 0 ? resendAttachments : undefined,
    });

    if (result.error) {
      throw new Error(`Resend error: ${result.error.message}`);
    }

    await this.incrementEmailCount(1);
    logger.info(
      `[EmailService] Email enviado para ${to} — id: ${result.data?.id}`
    );
    return result.data;
  }

  // ── Email de confirmação de pagamento (com ingresso) ──────────────────────

  async sendEmailConfirmationPayment({ checkoutId, participantId, data }) {
    const stats = await this.getEmailStats();
    if (stats.available <= 0)
      throw new Error("Limite diário de emails atingido.");

    const participant = await CheckoutRepository.getParticipantById(
      checkoutId,
      participantId
    );

    if (participant.emailSent) {
      logger.info(
        `[EmailService] Email já enviado para ${participant.email}, ignorando`
      );
      return { success: false, message: "Email já enviado anteriormente" };
    }

    // Gera e persiste o qrToken do participante (sem PDF)
    const { qrToken } = await CredentialService.generateQRCodesForParticipant(
      checkoutId,
      participantId,
      participant.name
    );

    const templatePath = path.join(
      __dirname,
      "../templates/emailTemplate.html"
    );
    let html = await fs.readFile(templatePath, "utf-8");

    const ticketUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/ingressos`
      : `https://congressoautismoma.com.br/ingressos`;

    html = html
      .replace(/{{nome}}/g, participant.name.toUpperCase() || "Participante")
      .replace(/{{transactionId}}/g, data.transactionId || "N/A")
      .replace(/{{fullTickets}}/g, data.fullTickets || 0)
      .replace(/{{valueTicketsAll}}/g, data.valueTicketsAll || "0.00")
      .replace(/{{halfTickets}}/g, data.halfTickets || 0)
      .replace(/{{installments}}/g, data.installments || 1)
      .replace(/{{valueTicketsHalf}}/g, data.valueTicketsHalf || "0.00")
      .replace(/{{total}}/g, data.total || "0.00")
      .replace(/{{ticketUrl}}/g, ticketUrl);

    if (data.discount && data.coupon) {
      html = html
        .replace(/{{#if discount}}/g, "")
        .replace(/{{\/if}}/g, "")
        .replace(/{{coupon}}/g, data.coupon)
        .replace(/{{discount}}/g, data.discount);
    } else {
      html = html.replace(/{{#if discount}}[\s\S]*?{{\/if}}/g, "");
    }

    await this.sendEmail({
      to: participant.email,
      subject:
        data.subject || `Confirmação de Pagamento — ${config.event.name}`,
      html,
    });

    // Salva qrToken no participante e marca email como enviado
    await CheckoutRepository.updateParticipant(checkoutId, participantId, {
      qrToken,
      emailSent: true,
      emailSentAt: new Date().toISOString(),
    });

    logger.info(`[EmailService] Confirmação enviada para ${participant.email}`);
    return { success: true, message: `Email enviado para ${participant.name}` };
  }

  // ── E-mail de confirmação de transferência de ingresso ───────────────────

  async sendTransferEmail({ checkoutId, participantId }) {
    const participant = await CheckoutRepository.getParticipantById(checkoutId, participantId);

    if (!participant.email) {
      throw new Error("Novo participante sem e-mail cadastrado.");
    }

    // Gera o qrToken para o novo titular
    const { qrToken } = await CredentialService.generateQRCodesForParticipant(
      checkoutId,
      participantId,
      participant.name
    );

    const templatePath = path.join(__dirname, "../templates/emailTemplateTransfer.html");
    let html = await fs.readFile(templatePath, "utf-8");

    const ticketUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/ingressos`
      : `https://congressoautismoma.com.br/ingressos`;

    html = html
      .replace(/{{nome}}/g, participant.name || "Participante")
      .replace(/{{ticketUrl}}/g, ticketUrl);

    await this.sendEmail({
      to: participant.email,
      subject: `Seu ingresso foi transferido — ${config.event.name}`,
      html,
    });

    await CheckoutRepository.updateParticipant(checkoutId, participantId, {
      qrToken,
      emailSent: true,
      emailSentAt: new Date().toISOString(),
    });

    logger.info(`[EmailService] E-mail de transferência enviado para ${participant.email}`);
    return { success: true, message: `E-mail enviado para ${participant.name}` };
  }

  // ── Envio em massa para todos os participantes de checkouts aprovados ─────

  async sendBulkEmailToCheckouts({
    checkoutIds,
    subject,
    templateFile,
    extraVars = {},
  }) {
    if (this.isProcessing) {
      return { success: false, message: "Processamento já em andamento" };
    }
    this.isProcessing = true;

    const templatePath = path.join(__dirname, `../templates/${templateFile}`);
    const baseHtml = await fs.readFile(templatePath, "utf-8");

    const results = { sent: 0, skipped: 0, errors: [] };
    const DELAY_BETWEEN_EMAILS = 200; // ms — Resend suporta bem, mas respeitamos

    try {
      for (const checkoutId of checkoutIds) {
        const participants = await CheckoutRepository.getParticipantsByCheckout(
          checkoutId
        );

        for (const participant of participants) {
          const stats = await this.getEmailStats();
          if (stats.available <= 0) {
            logger.error(
              "[EmailService] Limite diário atingido durante envio em massa"
            );
            return {
              ...results,
              success: false,
              message: "Limite diário atingido",
            };
          }

          if (participant.emailSent) {
            results.skipped++;
            continue;
          }

          let html = baseHtml.replace(
            /{{nome}}/g,
            participant.name || "Participante"
          );
          for (const [key, value] of Object.entries(extraVars)) {
            html = html.replace(new RegExp(`{{${key}}}`, "g"), value);
          }

          try {
            await this.sendEmail({ to: participant.email, subject, html });
            await CheckoutRepository.updateParticipant(
              checkoutId,
              participant.id,
              {
                emailSent: true,
                emailSentAt: new Date().toISOString(),
              }
            );
            results.sent++;
          } catch (err) {
            logger.error(
              `[EmailService] Erro para ${participant.email}: ${err.message}`
            );
            results.errors.push({
              email: participant.email,
              error: err.message,
            });
          }

          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_EMAILS));
        }
      }

      return { success: true, ...results };
    } finally {
      this.isProcessing = false;
      logger.info(
        `[EmailService] Envio em massa concluído: ${results.sent} enviados, ${results.skipped} pulados, ${results.errors.length} erros`
      );
    }
  }

  // ── Templates no Firestore ────────────────────────────────────────────────

  async getAllTemplates() {
    const snapshot = await db.collection("emailTemplates").get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async createTemplate(data) {
    const ref = await db.collection("emailTemplates").add({
      ...data,
      createdAt: new Date().toISOString(),
    });
    return ref.id;
  }

  async updateTemplate(templateId, data) {
    await db.collection("emailTemplates").doc(templateId).update(data);
  }

  async deleteTemplate(templateId) {
    await db.collection("emailTemplates").doc(templateId).delete();
  }
}

module.exports = new EmailService();
