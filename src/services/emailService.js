// backend/src/services/emailService.js
const nodemailer = require("nodemailer");
const { db } = require("../config");
const {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
} = require("firebase/firestore");
const fs = require("fs").promises;
const path = require("path");
const puppeteer = require("puppeteer");
require("dotenv").config();
const CredentialService = require("./CredentialService");

const emailAccounts = [
  { user: process.env.EMAIL_USER_1, pass: process.env.EMAIL_PASS_1 },
  { user: process.env.EMAIL_USER_2, pass: process.env.EMAIL_PASS_2 },
  { user: process.env.EMAIL_USER_3, pass: process.env.EMAIL_PASS_3 },
  { user: process.env.EMAIL_USER_4, pass: process.env.EMAIL_PASS_4 },
  { user: process.env.EMAIL_USER_5, pass: process.env.EMAIL_PASS_5 },
].filter((acc) => acc.user && acc.pass);

class EmailService {
  constructor() {
    this.isProcessing = false; // Flag para evitar execuções concorrentes
  }

  async fetchEmailTemplates() {
    const snapshot = await getDocs(collection(db, "emailTemplates"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async fetchCheckouts() {
    const snapshot = await getDocs(collection(db, "checkouts"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async sendEmail({ from, to, subject, html, attachments }) {
    const account = emailAccounts.find((acc) => acc.user === from);
    if (!account) {
      throw new Error("Conta de email não configurada.");
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

    await transporter.sendMail(mailOptions);
    console.log(`Email enviado de ${from} para ${to}`);
  }

  async generateTicketPDF(recipient, qrCodes) {
    const tempDir = path.join(__dirname, "../temp");
    const pdfPath = path.join(
      tempDir,
      `tickets_${recipient.checkoutId}_${recipient.participantIndex}.pdf`
    );

    await fs.mkdir(tempDir, { recursive: true });

    const qrCodeDay1 = qrCodes["2025-05-31"].toString("base64");
    const qrCodeDay2 = qrCodes["2025-06-01"].toString("base64");

    const templatePath = path.join(
      __dirname,
      "../templates/ticketTemplate.html"
    );
    const htmlTemplate = await fs.readFile(templatePath, "utf8");

    const htmlContent = htmlTemplate
      .replace(/{{PARTICIPANT_NAME}}/g, recipient.participantName.toUpperCase())
      .replace(/{{QRCODE_DAY1}}/g, qrCodeDay1)
      .replace(/{{QRCODE_DAY2}}/g, qrCodeDay2)
      .replace(/{{EVENT_NAME}}/g, "CONGRESSO AUTISMO MA 2025")
      .replace(/{{DATE_DAY1}}/g, "31.05.2025")
      .replace(/{{DATE_DAY2}}/g, "01.06.2025")
      .replace(/{{LOCATION}}/g, "CENTRO DE CONVENÇÕES MA")
      .replace(/{{TIME}}/g, "08:00 - 18:00")
      .replace(/{{SUPPORT_EMAIL}}/g, "suporte@congressoautismoma.com.br");

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: "/usr/lib64/chromium-browser/chromium-browser",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    await browser.close();

    console.log("PDF gerado com sucesso em:", pdfPath);
    return pdfPath;
  }

  async processAutomaticEmails() {
    if (this.isProcessing) {
      console.log("Processamento já em andamento, ignorando nova execução.");
      return;
    }

    this.isProcessing = true;
    console.log("Processando emails automáticos...");

    try {
      const templates = await this.fetchEmailTemplates();
      const checkouts = await this.fetchCheckouts();

      if (!templates.length) {
        console.log("Nenhum template disponível.");
        return;
      }

      const templatePath = path.join(
        __dirname,
        "../templates/emailTemplateSimple.html"
      );
      const htmlTemplate = await fs.readFile(templatePath, "utf-8");
      console.log("Template base carregado:", htmlTemplate.substring(0, 200));

      for (const template of templates) {
        const recipients = [];

        // Filtra os checkouts com base no status do template
        checkouts
          .filter(
            (c) =>
              c.status.toLowerCase() === template.statusFilter.toLowerCase()
          )
          .forEach((c) => {
            if (!c.sentEmails?.includes(template.id)) {
              if (template.statusFilter.toLowerCase() === "approved") {
                // Para status "approved", adiciona todos os participantes
                c.participants.forEach((p, index) => {
                  recipients.push({
                    email: p.email,
                    checkoutId: c.id,
                    participantName: p.name,
                    participantIndex: index,
                  });
                });
              } else {
                // Para outros status, adiciona apenas o primeiro participante
                recipients.push({
                  email: c.participants[0].email,
                  checkoutId: c.id,
                  participantName: c.participants[0].name,
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

          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: account.user, pass: account.pass },
          });

          for (const recipient of batch) {
            let html = htmlTemplate;
            console.log(
              `Processando recipient ${recipient.email} com template ${template.id}`
            );

            // Substitui os placeholders
            html = html
              .replace("{{nome}}", recipient.participantName || "Participante")
              .replace("{{title}}", template.title) // Título dinâmico
              .replace("{{body}}", template.body) // Corpo dinâmico
              .replace("{{subject}}", template.subject); // Assunto dinâmico

            console.log(`HTML final para ${recipient.email}:`, html);

            let attachments = [];
            // Anexa QR codes apenas se o template for configurado para isso
            if (
              template.includeQRCodes &&
              template.statusFilter.toLowerCase() === "approved"
            ) {
              const qrCodes =
                await CredentialService.generateQRCodesForParticipant(
                  recipient.checkoutId,
                  recipient.participantIndex
                );
              console.log(`QR Codes gerados para ${recipient.email}:`, qrCodes);

              const pdfPath = await this.generateTicketPDF(recipient, qrCodes);
              attachments.push({
                filename: `ingressos_${recipient.participantName}.pdf`,
                path: pdfPath,
                contentType: "application/pdf",
              });
            }

            try {
              await transporter.sendMail({
                from: account.user,
                to: recipient.email,
                subject: template.subject,
                html,
                attachments,
              });
              console.log(`Email automático enviado para ${recipient.email}`);

              // Marca o template como enviado no checkout
              const checkoutRef = doc(db, "checkouts", recipient.checkoutId);
              const checkout = checkouts.find(
                (c) => c.id === recipient.checkoutId
              );
              const updatedSentEmails = [
                ...(checkout.sentEmails || []),
                template.id,
              ];
              await updateDoc(checkoutRef, {
                sentEmails: updatedSentEmails,
              });
              console.log(
                `Template ${template.id} marcado como enviado para checkout ${recipient.checkoutId}`
              );

              // Atualiza o checkout localmente para evitar reprocessamento
              checkout.sentEmails = updatedSentEmails;

              // Remove arquivos temporários após o envio
              if (attachments.length > 0) {
                try {
                  await fs.unlink(attachments[0].path);
                  console.log(
                    `Arquivo temporário ${attachments[0].path} removido`
                  );
                } catch (unlinkError) {
                  if (unlinkError.code !== "ENOENT") {
                    throw unlinkError; // Propaga erros diferentes de "arquivo não encontrado"
                  }
                  console.log(
                    `Arquivo ${attachments[0].path} já foi removido anteriormente`
                  );
                }
              }

              sentCount++;
            } catch (error) {
              console.error(
                `Erro ao enviar email automático para ${recipient.email}:`,
                error.message
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro ao processar emails automáticos:", error.message);
    } finally {
      this.isProcessing = false; // Libera para próxima execução
    }
  }

  startEmailService() {
    console.log("Iniciando serviço de emails automáticos...");
    setInterval(() => this.processAutomaticEmails(), 900000);
  }
}

module.exports = new EmailService();
