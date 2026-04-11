const { db, admin } = require("../config").firebase;
const AudienceService = require("./AudienceService");
const EmailService = require("./EmailService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const logger = require("../logger");

// ─── Estrutura de campanha no Firestore ──────────────────────────────────
//
// emailCampaigns/{campaignId}
//   name            : string
//   audienceId      : string  → referência à audiência
//   subject         : string
//   htmlBody        : string  → HTML completo editável pelo admin
//   includeTicket   : bool    → se true, gera e anexa PDF com QR code
//   sendOnNew       : bool    → se true, dispara automaticamente para novos que se encaixam
//   active          : bool
//   sentCount       : number
//   createdAt, updatedAt
//
// emailCampaignLogs/{logId}   → rastreia quem já recebeu cada campanha
//   campaignId, participantId, checkoutId, email
//   sentAt, status: "sent" | "error", errorMessage?
//
// ─────────────────────────────────────────────────────────────────────────

class CampaignService {
  // ── CRUD de campanhas ─────────────────────────────────────────────────────

  async createCampaign({
    name,
    audienceId,
    subject,
    htmlBody,
    includeTicket = false,
    sendOnNew = false,
  }) {
    if (!name || !audienceId || !subject || !htmlBody) {
      throw new Error("name, audienceId, subject e htmlBody são obrigatórios.");
    }

    // Valida que a audiência existe
    await AudienceService.getAudienceById(audienceId);

    const ref = await db.collection("emailCampaigns").add({
      name,
      audienceId,
      subject,
      htmlBody,
      includeTicket,
      sendOnNew,
      active: true,
      sentCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`[CampaignService] Campanha criada: ${ref.id}`);
    return ref.id;
  }

  async getAllCampaigns() {
    const snap = await db
      .collection("emailCampaigns")
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getCampaignById(campaignId) {
    const snap = await db.collection("emailCampaigns").doc(campaignId).get();
    if (!snap.exists) throw new Error(`Campanha ${campaignId} não encontrada.`);
    return { id: snap.id, ...snap.data() };
  }

  async updateCampaign(campaignId, data) {
    await db
      .collection("emailCampaigns")
      .doc(campaignId)
      .update({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  async deleteCampaign(campaignId) {
    await db.collection("emailCampaigns").doc(campaignId).delete();
  }

  // ── Verificação de log (evita reenvio) ────────────────────────────────────

  async hasAlreadyReceived(campaignId, participantId) {
    const snap = await db
      .collection("emailCampaignLogs")
      .where("campaignId", "==", campaignId)
      .where("participantId", "==", participantId)
      .where("status", "==", "sent")
      .limit(1)
      .get();
    return !snap.empty;
  }

  async logSend(
    campaignId,
    participantId,
    checkoutId,
    email,
    status,
    errorMessage = null
  ) {
    await db.collection("emailCampaignLogs").add({
      campaignId,
      participantId,
      checkoutId,
      email,
      status,
      errorMessage,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (status === "sent") {
      await db
        .collection("emailCampaigns")
        .doc(campaignId)
        .update({
          sentCount: admin.firestore.FieldValue.increment(1),
        });
    }
  }

  // ── Envia campanha para um participante específico ────────────────────────

  async sendToParticipant(campaign, checkout, participant) {
    const alreadyReceived = await this.hasAlreadyReceived(
      campaign.id,
      participant.id
    );
    if (alreadyReceived) {
      logger.info(
        `[CampaignService] ${participant.email} já recebeu campanha ${campaign.id}`
      );
      return { skipped: true };
    }

    // Renderiza o HTML substituindo variáveis
    let html = campaign.htmlBody
      .replace(/{{nome}}/g, participant.name || "Participante")
      .replace(/{{email}}/g, participant.email || "")
      .replace(/{{cpf}}/g, participant.cpf || "")
      .replace(
        /{{ticketType}}/g,
        participant.ticketType === "half" ? "Meia" : "Inteira"
      )
      .replace(/{{paymentMethod}}/g, checkout.paymentMethod || "")
      .replace(/{{total}}/g, checkout.orderDetails?.total || "0.00")
      .replace(/{{coupon}}/g, checkout.orderDetails?.coupon || "");

    let attachments = [];

    // Se a campanha inclui ingresso com QR code
    if (campaign.includeTicket) {
      try {
        const CredentialService = require("./CredentialService");
        const { generateTicketPDF } = require("../utils/templateUtils");

        const { qrCodes, qrToken } =
          await CredentialService.generateQRCodesForParticipant(
            checkout.id,
            participant.id,
            participant.name
          );

        const pdfPath = await generateTicketPDF(
          {
            checkoutId: checkout.id,
            participantName: participant.name || "Participante",
            transactionId:
              checkout.transactionId || checkout.paymentId || "N/A",
            total: checkout.orderDetails?.total || "0.00",
          },
          qrCodes
        );

        const safeName = (participant.name || "Participante").replace(
          /\s/g,
          "_"
        );
        attachments.push({
          filename: `ingresso_${safeName}.pdf`,
          path: pdfPath,
        });

        // Salva qrToken no participante se ainda não tiver
        if (!participant.qrToken) {
          await CheckoutRepository.updateParticipant(
            checkout.id,
            participant.id,
            { qrToken }
          );
        }
      } catch (err) {
        logger.error(
          `[CampaignService] Erro ao gerar ingresso para ${participant.email}: ${err.message}`
        );
        throw err;
      }
    }

    try {
      await EmailService.sendEmail({
        to: participant.email,
        subject: campaign.subject,
        html,
        attachments,
      });

      await this.logSend(
        campaign.id,
        participant.id,
        checkout.id,
        participant.email,
        "sent"
      );
      logger.info(
        `[CampaignService] Campanha ${campaign.id} → ${participant.email}`
      );
      return { sent: true };
    } catch (err) {
      await this.logSend(
        campaign.id,
        participant.id,
        checkout.id,
        participant.email,
        "error",
        err.message
      );
      throw err;
    } finally {
      // Limpa PDF temporário
      if (attachments.length > 0 && attachments[0].path) {
        const fs = require("fs").promises;
        await fs.unlink(attachments[0].path).catch(() => {});
      }
    }
  }

  // ── Disparo em massa manual de uma campanha ───────────────────────────────

  async dispatchCampaign(campaignId) {
    const campaign = await this.getCampaignById(campaignId);
    if (!campaign.active) throw new Error("Campanha inativa.");

    const results = { sent: 0, skipped: 0, errors: [] };
    const DELAY = 150; // ms entre envios para não sobrecarregar o Resend

    await AudienceService.forEachMatchingParticipant(
      campaign.audienceId,
      async (checkout, participant) => {
        const stats = await EmailService.getEmailStats();
        if (stats.available <= 0) {
          throw new Error("Limite diário de envios atingido.");
        }

        try {
          const result = await this.sendToParticipant(campaign, checkout, participant);
          if (result.skipped) results.skipped++;
          else results.sent++;
        } catch (err) {
          results.errors.push({ email: participant.email, error: err.message });
        }

        await new Promise((r) => setTimeout(r, DELAY));
      }
    );

    logger.info(
      `[CampaignService] Disparo concluído — enviados: ${results.sent}, pulados: ${results.skipped}, erros: ${results.errors.length}`
    );
    return { success: true, ...results };
  }

  // ── Disparo automático para novos checkouts aprovados ────────────────────
  // Chamado pelo CheckoutService quando um checkout muda de status

  async triggerForCheckout(checkout) {
    // Busca campanhas com sendOnNew = true e active = true
    const campaignsSnap = await db
      .collection("emailCampaigns")
      .where("sendOnNew", "==", true)
      .where("active", "==", true)
      .get();

    if (campaignsSnap.empty) return;

    const participants = await CheckoutRepository.getParticipantsByCheckout(
      checkout.id
    );

    for (const campaignDoc of campaignsSnap.docs) {
      const campaign = { id: campaignDoc.id, ...campaignDoc.data() };

      let audience;
      try {
        audience = await AudienceService.getAudienceById(campaign.audienceId);
      } catch {
        continue; // audiência deletada, pula
      }

      for (const participant of participants) {
        // Verifica se o participante se encaixa no público
        if (
          !AudienceService.participantMatchesAudience(
            checkout,
            participant,
            audience.filters
          )
        ) {
          continue;
        }

        try {
          await this.sendToParticipant(campaign, checkout, participant);
        } catch (err) {
          logger.error(
            `[CampaignService] Erro no disparo automático para ${participant.email}: ${err.message}`
          );
        }
      }
    }
  }

  // ── Logs de uma campanha ──────────────────────────────────────────────────

  async getCampaignLogs(campaignId, limit = 100) {
    const snap = await db
      .collection("emailCampaignLogs")
      .where("campaignId", "==", campaignId)
      .orderBy("sentAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

module.exports = new CampaignService();
