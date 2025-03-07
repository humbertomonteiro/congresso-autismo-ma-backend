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
require("dotenv").config();

const emailAccounts = [
  { user: process.env.EMAIL_USER_1, pass: process.env.EMAIL_PASS_1 },
  { user: process.env.EMAIL_USER_2, pass: process.env.EMAIL_PASS_2 },
  { user: process.env.EMAIL_USER_3, pass: process.env.EMAIL_PASS_3 },
  { user: process.env.EMAIL_USER_4, pass: process.env.EMAIL_PASS_4 },
  { user: process.env.EMAIL_USER_5, pass: process.env.EMAIL_PASS_5 },
].filter((acc) => acc.user && acc.pass);

class EmailService {
  async fetchEmailTemplates() {
    const snapshot = await getDocs(collection(db, "emailTemplates"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async fetchCheckouts() {
    const snapshot = await getDocs(collection(db, "checkouts"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async sendEmail({ from, to, subject, html }) {
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
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email enviado de ${from} para ${to}`);
  }

  async sendTemplateImmediately(templateId) {
    const templateRef = doc(db, "emailTemplates", templateId);
    const templateDoc = await getDoc(templateRef);
    if (!templateDoc.exists()) throw new Error("Template não encontrado.");

    const template = { id: templateDoc.id, ...templateDoc.data() };
    const checkouts = await this.fetchCheckouts();

    const templatePath = path.join(
      __dirname,
      "../templates/emailTemplateAdditional.html"
    );
    let htmlTemplate = await fs.readFile(templatePath, "utf-8");

    const recipients = [];
    if (template.sendType === "single" && template.singleEmail) {
      recipients.push({ email: template.singleEmail });
    } else if (template.sendType === "status") {
      checkouts
        .filter(
          (c) => c.status.toLowerCase() === template.statusFilter.toLowerCase()
        )
        .forEach((c) => {
          if (!c.sentEmails?.includes(template.id)) {
            if (template.statusFilter.toLowerCase() === "approved") {
              c.participants.forEach((p) => {
                recipients.push({
                  email: p.email,
                  checkoutId: c.id,
                  participantName: p.name,
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
    }

    if (recipients.length === 0) {
      console.log(
        `Nenhum destinatário para envio imediato do template ${template.id}`
      );
      return;
    }

    const emailsPerAccount = Math.ceil(
      recipients.length / emailAccounts.length
    );
    let sentCount = 0;

    for (const account of emailAccounts) {
      const batch = recipients.slice(sentCount, sentCount + emailsPerAccount);
      if (!batch.length) break;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: account.user, pass: account.pass },
      });

      for (const recipient of batch) {
        let html = htmlTemplate
          .replace("{{nome}}", recipient.participantName || "Participante")
          .replace("{{body}}", template.body)
          .replace("{{subject}}", template.subject);

        if (template.statusFilter.toLowerCase() !== "approved") {
          html = html
            .replace("{{#if alternativePayment}}", "")
            .replace("{{/if}}", "");
        } else {
          html = html.replace(
            /{{#if alternativePayment}}[\s\S]*?{{\/if}}/g,
            ""
          );
        }

        try {
          await transporter.sendMail({
            from: account.user,
            to: recipient.email,
            subject: template.subject,
            html,
          });
          console.log(`Email imediato enviado para ${recipient.email}`);

          const checkoutRef = doc(db, "checkouts", recipient.checkoutId);
          const checkout = checkouts.find((c) => c.id === recipient.checkoutId);
          await updateDoc(checkoutRef, {
            sentEmails: [...(checkout.sentEmails || []), template.id],
          });
          console.log(
            `Template ${template.id} marcado como enviado para checkout ${recipient.checkoutId}`
          );
          sentCount++;
        } catch (error) {
          console.error(
            `Erro ao enviar email imediato para ${recipient.email}:`,
            error.message
          );
        }
      }
    }
  }

  async processAutomaticEmails() {
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
        "../templates/emailTemplateAdditional.html"
      );
      let htmlTemplate = await fs.readFile(templatePath, "utf-8");

      for (const template of templates) {
        const recipients = [];
        if (template.sendType === "single" && template.singleEmail) {
          recipients.push({ email: template.singleEmail });
        } else if (template.sendType === "status") {
          checkouts
            .filter(
              (c) =>
                c.status.toLowerCase() === template.statusFilter.toLowerCase()
            )
            .forEach((c) => {
              if (!c.sentEmails?.includes(template.id)) {
                if (template.statusFilter.toLowerCase() === "approved") {
                  c.participants.forEach((p) => {
                    recipients.push({
                      email: p.email,
                      checkoutId: c.id,
                      participantName: p.name,
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
        }

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
            let html = htmlTemplate
              .replace("{{nome}}", recipient.participantName || "Participante")
              .replace("{{body}}", template.body)
              .replace("{{subject}}", template.subject);

            if (template.statusFilter.toLowerCase() !== "approved") {
              html = html
                .replace("{{#if alternativePayment}}", "")
                .replace("{{/if}}", "");
            } else {
              html = html.replace(
                /{{#if alternativePayment}}[\s\S]*?{{\/if}}/g,
                ""
              );
            }

            try {
              await transporter.sendMail({
                from: account.user,
                to: recipient.email,
                subject: template.subject,
                html,
              });
              console.log(`Email automático enviado para ${recipient.email}`);

              const checkoutRef = doc(db, "checkouts", recipient.checkoutId);
              const checkout = checkouts.find(
                (c) => c.id === recipient.checkoutId
              );
              await updateDoc(checkoutRef, {
                sentEmails: [...(checkout.sentEmails || []), template.id],
              });
              console.log(
                `Template ${template.id} marcado como enviado para checkout ${recipient.checkoutId}`
              );
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
    }
  }

  startEmailService() {
    console.log("Iniciando serviço de emails automáticos...");
    setInterval(() => this.processAutomaticEmails(), 900000);
  }
}

module.exports = new EmailService();
