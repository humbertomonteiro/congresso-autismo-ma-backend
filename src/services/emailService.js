const nodemailer = require("nodemailer");
const { db } = require("../config");
const {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
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
    this.isProcessing = false;
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

    try {
      await fs.mkdir(tempDir, { recursive: true });

      const qrCodeDay1 = qrCodes["2025-05-31"].toString("base64");
      const qrCodeDay2 = qrCodes["2025-06-01"].toString("base64");

      const templatePath = path.join(
        __dirname,
        "../templates/ticketTemplate.html"
      );
      const htmlTemplate = await fs.readFile(templatePath, "utf8");

      const htmlContent = htmlTemplate
        .replace(
          /{{PARTICIPANT_NAME}}/g,
          recipient.participantName.toUpperCase()
        )
        .replace(/{{QRCODE_DAY1}}/g, qrCodeDay1)
        .replace(/{{QRCODE_DAY2}}/g, qrCodeDay2)
        .replace(/{{EVENT_NAME}}/g, "CONGRESSO AUTISMO MA 2025")
        .replace(/{{DATE_DAY1}}/g, "31.05.2025")
        .replace(/{{DATE_DAY2}}/g, "01.06.2025")
        .replace(/{{LOCATION}}/g, "CENTRO DE CONVENÇÕES MA")
        .replace(/{{TIME}}/g, "08:00 - 18:00")
        .replace(/{{SUPPORT_EMAIL}}/g, "suporte@congressoautismoma.com.br");

      const executablePath =
        process.env.NODE_ENV === "production"
          ? "/usr/local/chromium/chrome" // Caminho para AWS
          : undefined; // Chromium padrão localmente

      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
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
    } catch (error) {
      console.error("Erro ao gerar PDF:", error.message);
      throw error;
    }
  }

  async sendQRCodesForApprovedCheckouts() {
    if (this.isProcessing) {
      console.log("Processamento já em andamento, ignorando nova execução.");
      return;
    }

    this.isProcessing = true;
    console.log("Enviando QR codes para checkouts aprovados...");

    try {
      const checkouts = await this.fetchCheckouts();
      const approvedCheckouts = checkouts.filter(
        (c) => c.status.toLowerCase() === "approved"
      );

      if (!approvedCheckouts.length) {
        console.log("Nenhum checkout aprovado encontrado.");
        return;
      }

      for (const checkout of approvedCheckouts) {
        const qrCodeSentFlag = `qrCodesSent_${checkout.id}`;
        const checkoutRef = doc(db, "checkouts", checkout.id);
        const checkoutSnap = await getDoc(checkoutRef);
        const checkoutData = checkoutSnap.data();

        // Verifica se os QR codes já foram enviados para este checkout
        if (checkoutData.qrCodesSent) {
          console.log(`QR codes já enviados para checkout ${checkout.id}`);
          continue;
        }

        const emailSet = new Set(); // Verifica e-mails duplicados
        const recipients = checkout.participants
          .map((p, index) => {
            if (emailSet.has(p.email)) {
              console.warn(
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
          const html = `
            <h2>Olá ${recipient.participantName},</h2>
            <p>Seu pagamento foi aprovado! Aqui estão seus QR codes para o Congresso Autismo MA 2025.</p>
            <p>Apresente o PDF anexo na entrada do evento em cada dia.</p>
            <p>Atenciosamente,<br>Equipe Congresso Autismo MA</p>
            <p><small>Suporte: suporte@congressoautismoma.com.br</small></p>
          `;

          let attachments = [];
          try {
            const { qrCodes, qrRawData } =
              await CredentialService.generateQRCodesForParticipant(
                recipient.checkoutId,
                recipient.participantIndex,
                recipient.participantName
              );

            const pdfPath = await this.generateTicketPDF(recipient, qrCodes);
            attachments.push({
              filename: `ingressos_${recipient.participantName}.pdf`,
              path: pdfPath,
              contentType: "application/pdf",
            });

            const participant =
              checkoutData.participants[recipient.participantIndex];
            participant.qrRawData = qrRawData;
            participant.validated = {
              "2025-05-31": false,
              "2025-06-01": false,
            };
            await updateDoc(checkoutRef, {
              participants: checkoutData.participants,
            });
          } catch (pdfError) {
            console.error(
              `Erro ao gerar PDF para ${recipient.email}:`,
              pdfError.message
            );
            continue; // Pula este participante se o PDF falhar
          }

          try {
            await this.sendEmail({
              from: emailAccounts[0].user, // Usa o primeiro e-mail disponível
              to: recipient.email,
              subject: "Seus QR Codes - Congresso Autismo MA 2025",
              html,
              attachments,
            });

            // Marca como enviado no Firebase
            await updateDoc(checkoutRef, { qrCodesSent: true });
            console.log(
              `QR codes enviados para ${recipient.email} (checkout ${checkout.id})`
            );
          } catch (emailError) {
            console.error(
              `Erro ao enviar email para ${recipient.email}:`,
              emailError.message
            );
          } finally {
            if (attachments.length > 0) {
              try {
                await fs.unlink(attachments[0].path);
                console.log(
                  `Arquivo temporário ${attachments[0].path} removido`
                );
              } catch (unlinkError) {
                if (unlinkError.code !== "ENOENT") {
                  console.error(
                    "Erro ao remover arquivo temporário:",
                    unlinkError.message
                  );
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro ao enviar QR codes:", error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  startQRCodeService() {
    console.log("Iniciando serviço de envio de QR codes...");
    setInterval(() => this.sendQRCodesForApprovedCheckouts(), 900000);
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

      for (const template of templates) {
        const recipients = [];

        checkouts
          .filter(
            (c) =>
              c.status.toLowerCase() === template.statusFilter.toLowerCase()
          )
          .forEach((c) => {
            if (!c.sentEmails?.includes(template.id)) {
              if (template.statusFilter.toLowerCase() === "approved") {
                const emailSet = new Set(); // Verifica e-mails duplicados
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
            html = html
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

              const pdfPath = await this.generateTicketPDF(recipient, qrCodes);
              attachments.push({
                filename: `ingressos_${recipient.participantName}.pdf`,
                path: pdfPath,
                contentType: "application/pdf",
              });

              const checkoutRef = doc(db, "checkouts", recipient.checkoutId);
              const checkoutSnap = await getDoc(checkoutRef);
              const checkout = checkoutSnap.data();
              const participant =
                checkout.participants[recipient.participantIndex];
              participant.qrRawData = qrRawData;
              participant.validated = {
                "2025-05-31": false,
                "2025-06-01": false,
              };
              await updateDoc(checkoutRef, {
                participants: checkout.participants,
              });
            }

            await transporter.sendMail({
              from: account.user,
              to: recipient.email,
              subject: template.subject,
              html,
              attachments,
            });
            console.log(`Email automático enviado para ${recipient.email}`);

            const checkoutRef = doc(db, "checkouts", recipient.checkoutId);
            const checkout = checkouts.find(
              (c) => c.id === recipient.checkoutId
            );
            const updatedSentEmails = [
              ...(checkout.sentEmails || []),
              template.id,
            ];
            await updateDoc(checkoutRef, { sentEmails: updatedSentEmails });
            checkout.sentEmails = updatedSentEmails;

            if (attachments.length > 0) {
              try {
                await fs.unlink(attachments[0].path);
                console.log(
                  `Arquivo temporário ${attachments[0].path} removido`
                );
              } catch (unlinkError) {
                if (unlinkError.code !== "ENOENT") throw unlinkError;
                console.log(`Arquivo ${attachments[0].path} já foi removido`);
              }
            }

            sentCount++;
          }
        }
      }
    } catch (error) {
      console.error("Erro ao processar emails automáticos:", error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  startEmailService() {
    console.log("Iniciando serviço de emails automáticos...");
    setInterval(() => this.processAutomaticEmails(), 900000);
  }
}

module.exports = new EmailService();
