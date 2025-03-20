const logger = require("../logger");
const nodemailer = require("nodemailer");
const EmailRepository = require("../repositories/EmailRepository");
const CredentialService = require("./CredentialService");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const puppeteer = require("puppeteer");
const { generateTicketPDF } = require("../utils/templateUtils");
require("dotenv").config();

const emailAccounts = [
  { user: process.env.EMAIL_USER_1, pass: process.env.EMAIL_PASS_1 },
  { user: process.env.EMAIL_USER_2, pass: process.env.EMAIL_PASS_2 },
  { user: process.env.EMAIL_USER_3, pass: process.env.EMAIL_PASS_3 },
  { user: process.env.EMAIL_USER_4, pass: process.env.EMAIL_PASS_4 },
  { user: process.env.EMAIL_USER_5, pass: process.env.EMAIL_PASS_5 },
].filter((acc) => acc.user && acc.pass);

class EmailService {
  constructor() {
    this.isProcessing = false;
  }

  async sendManualEmail({ from, to, subject, data }) {
    const templatePath = path.join(
      __dirname,
      "../templates/emailTemplate.html"
    );
    let htmlTemplate = await fs.readFile(templatePath, "utf-8");

    htmlTemplate = htmlTemplate
      .replace("{{nome}}", data.name || "Participante")
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

    await this.sendEmail({ from, to, subject, html: htmlTemplate });
  }

  async generateEmailTemplate(status, theme) {
    const xaiResponse = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente que gera templates de email. Crie um assunto e um corpo de email com base no status e tema fornecidos. Use {{nome}} como placeholder para o nome do destinatário. Retorne o resultado no formato: 'Subject: [assunto]\nBody: [corpo]'.",
          },
          {
            role: "user",
            content: `Gere um template de email para o status "${status}" com o tema "${theme}".`,
          },
        ],
        model: "grok-2-latest",
        stream: false,
        temperature: 0,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
      }
    );

    const generatedContent = xaiResponse.data.choices[0].message.content;
    const [subjectLine, ...bodyLines] = generatedContent.split("\n");
    const subject = subjectLine.replace("Subject: ", "").trim();
    const body = bodyLines.join("\n").replace("Body: ", "").trim();

    return { subject, body };
  }

  async sendTemplateImmediately(templateId) {
    await this.processAutomaticEmails([templateId]);
  }

  async createContactList(name, description) {
    const listData = {
      name,
      description: description || "",
      contacts: [],
      createdAt: new Date().toISOString(),
    };
    const id = await EmailRepository.createContactList(listData);
    return { id, ...listData };
  }

  async addContactToList(listId, email) {
    await EmailRepository.addContactToList(listId, email);
  }

  async sendEmail({ from, to, subject, html, attachments }) {
    const account = emailAccounts.find((acc) => acc.user === from);
    if (!account) throw new Error("Conta de email não configurada.");

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

    await transporter.sendMail(mailOptions);
    console.log(`Email enviado de ${from} para ${to}`);
  }

  async sendQRCodesForApprovedCheckouts() {
    if (this.isProcessing) {
      logger.info("Processamento já em andamento, ignorando nova execução.");
      return;
    }

    this.isProcessing = true;
    logger.info("Iniciando envio de QR codes para checkouts aprovados...");

    const processingCheckouts = new Set();

    try {
      const checkouts = await EmailRepository.fetchCheckouts();
      const approvedCheckouts = checkouts.filter(
        (c) => c.status.toLowerCase() === "approved"
      );
      logger.info(
        `Encontrados ${approvedCheckouts.length} checkouts aprovados`
      );

      // Carrega o template simples uma vez
      const templatePath = path.join(
        __dirname,
        "../templates/emailTemplateSimple.html"
      );
      const htmlTemplate = await fs.readFile(templatePath, "utf-8");

      for (const checkout of approvedCheckouts) {
        if (checkout.qrCodesSent || processingCheckouts.has(checkout.id)) {
          logger.info(
            `QR codes já enviados ou em processamento para checkout ${checkout.id}`
          );
          continue;
        }

        processingCheckouts.add(checkout.id);

        const emailSet = new Set();
        const recipients = checkout.participants
          .map((p, index) => {
            if (emailSet.has(p.email)) {
              logger.warn(
                `E-mail duplicado detectado: ${p.email} no checkout ${checkout.id}`
              );
              return null;
            }
            emailSet.add(p.email);
            return {
              email: p.email,
              checkoutId: checkout.id,
              participantName: p.name,
              participantIndex: index,
            };
          })
          .filter((r) => r !== null);

        for (const recipient of recipients) {
          logger.info(`Processando QR codes para ${recipient.email}`);

          // Preenche o template com conteúdo personalizado
          const html = htmlTemplate
            .replace("{{nome}}", recipient.participantName || "Participante")
            .replace(
              "{{title}}",
              "Seu Passaporte para o Congresso Autismo MA 2025"
            )
            .replace(
              "{{body}}",
              "Seja bem-vindo a terceira edição do congresso de autismo e neurodiversidade em são luís- MA.<br><br>" +
                "<strong>Importante: Esteja atento as regras de natureza obrigatória com respeito ao uso das credenciais e utilização do crachá de identifi cação, que será disponibilizado no dia do evento:</strong><br><br>" +
                "<p>1- O QR-code tem a única função de fornecer a liberação da sua entrada no congresso. Para cada dia uma autorização de QR-code diferente.</p><br><br>" +
                "<p>2- O uso do crachá é obrigatório. Portanto, é de inteira responsabilidade do inscrito o zelo para com a sua identifi cação. Pois, a equipe de fi scalização será aconselhada a não autorizar a permanência de inscritos que se apresentarem sem o uso de seu crachá.</p><br><br>" +
                "<p>Em caso de dúvidas, fi que a vontade para entrar em contato com a nossa equipe de suporte pelos canais de atendimento (e-mail, telefones).</p><br><br>" +
                "Cordialmente, a comissão organizadora.<br><br>"
            );

          let attachments = [];
          try {
            const { qrCodes, qrRawData } =
              await CredentialService.generateQRCodesForParticipant(
                recipient.checkoutId,
                recipient.participantIndex,
                recipient.participantName
              );
            logger.info(
              `QR codes gerados para ${recipient.email}: ${JSON.stringify(
                qrCodes
              )}`
            );

            const pdfPath = await generateTicketPDF(recipient, qrCodes);
            attachments.push({
              filename: `ingressos_${recipient.participantName}.pdf`,
              path: pdfPath,
              contentType: "application/pdf",
            });

            const participantUpdate = {
              qrRawData,
              validated: { "2025-05-31": false, "2025-06-01": false },
            };
            await EmailRepository.updateParticipant(
              checkout.id,
              recipient.participantIndex,
              participantUpdate
            );
            logger.info(`Participante atualizado no checkout ${checkout.id}`);

            await this.sendEmail({
              from: emailAccounts[0].user,
              to: recipient.email,
              subject: "Seu Passaporte para o Congresso Autismo MA 2025",
              html,
              attachments,
            });

            await EmailRepository.updateCheckout(checkout.id, {
              qrCodesSent: true,
            });
            logger.info(
              `QR codes enviados para ${recipient.email} (checkout ${checkout.id})`
            );
          } catch (error) {
            logger.error(
              `Erro ao processar ${recipient.email} (checkout ${checkout.id}): ${error.message}`
            );
          } finally {
            if (attachments.length > 0) {
              await fs
                .unlink(attachments[0].path)
                .catch((err) =>
                  err.code !== "ENOENT"
                    ? logger.error(`Erro ao remover arquivo: ${err.message}`)
                    : null
                );
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Erro geral ao enviar QR codes: ${error.message}`);
      throw error;
    } finally {
      this.isProcessing = false;
      logger.info("Processamento de QR codes finalizado");
    }
  }
  async processAutomaticEmails(templateIds = null) {
    if (this.isProcessing) {
      console.log("Processamento já em andamento, ignorando nova execução.");
      return;
    }

    this.isProcessing = true;
    console.log("Processando emails automáticos...");

    try {
      const templates = await EmailRepository.fetchEmailTemplates();
      const checkouts = await EmailRepository.fetchCheckouts();
      const filteredTemplates = templateIds
        ? templates.filter((t) => templateIds.includes(t.id))
        : templates;

      const templatePath = path.join(
        __dirname,
        "../templates/emailTemplateSimple.html"
      );
      const htmlTemplate = await fs.readFile(templatePath, "utf-8");

      for (const template of filteredTemplates) {
        const recipients = [];
        checkouts
          .filter(
            (c) =>
              c.status.toLowerCase() === template.statusFilter.toLowerCase()
          )
          .forEach((c) => {
            if (!c.sentEmails?.includes(template.id)) {
              if (template.statusFilter.toLowerCase() === "approved") {
                const emailSet = new Set();
                c.participants.forEach((p, index) => {
                  if (emailSet.has(p.email)) {
                    console.warn(
                      `E-mail duplicado detectado: ${p.email} no checkout ${c.id}`
                    );
                    return;
                  }
                  emailSet.add(p.email);
                  recipients.push({
                    email: p.email,
                    checkoutId: c.id,
                    participantName: p.name,
                    participantIndex: index,
                  });
                });
              } else {
                recipients.push({
                  email: c.participants[0].email,
                  checkoutId: c.id,
                  participantName: c.participants[0].name,
                  participantIndex: 0,
                });
              }
            }
          });

        if (recipients.length === 0) {
          console.log(
            `Nenhum novo destinatário para o template ${template.id}`
          );
          continue;
        }

        const emailsPerAccount = Math.ceil(
          recipients.length / emailAccounts.length
        );
        let sentCount = 0;

        for (const account of emailAccounts) {
          const batch = recipients.slice(
            sentCount,
            sentCount + emailsPerAccount
          );
          if (!batch.length) break;

          for (const recipient of batch) {
            let html = htmlTemplate
              .replace("{{nome}}", recipient.participantName || "Participante")
              .replace("{{title}}", template.title)
              .replace("{{body}}", template.body)
              .replace("{{subject}}", template.subject);

            let attachments = [];
            if (
              template.includeQRCodes &&
              template.statusFilter.toLowerCase() === "approved"
            ) {
              const { qrCodes, qrRawData } =
                await CredentialService.generateQRCodesForParticipant(
                  recipient.checkoutId,
                  recipient.participantIndex,
                  recipient.participantName
                );

              const pdfPath = await generateTicketPDF(recipient, qrCodes);
              attachments.push({
                filename: `ingressos_${recipient.participantName}.pdf`,
                path: pdfPath,
                contentType: "application/pdf",
              });

              const participantUpdate = {
                qrRawData,
                validated: { "2025-05-31": false, "2025-06-01": false },
              };
              await EmailRepository.updateParticipant(
                recipient.checkoutId,
                recipient.participantIndex,
                participantUpdate
              );
            }

            await this.sendEmail({
              from: account.user,
              to: recipient.email,
              subject: template.subject,
              html,
              attachments,
            });
            console.log(`Email automático enviado para ${recipient.email}`);

            const updatedSentEmails = [
              ...(checkouts.find((c) => c.id === recipient.checkoutId)
                .sentEmails || []),
              template.id,
            ];
            await EmailRepository.updateCheckout(recipient.checkoutId, {
              sentEmails: updatedSentEmails,
            });

            if (attachments.length > 0) {
              await fs
                .unlink(attachments[0].path)
                .catch((err) =>
                  err.code !== "ENOENT"
                    ? console.error("Erro ao remover arquivo:", err.message)
                    : null
                );
            }

            sentCount++;
          }
        }
      }
    } catch (error) {
      console.error("Erro ao processar emails automáticos:", error.message);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  startQRCodeService() {
    console.log("Iniciando serviço de envio de QR codes...");
    setInterval(() => this.sendQRCodesForApprovedCheckouts(), 2400000);
  }

  startEmailService() {
    console.log("Iniciando serviço de emails automáticos...");
    setInterval(() => this.processAutomaticEmails(), 4800000);
  }
}

module.exports = new EmailService();
