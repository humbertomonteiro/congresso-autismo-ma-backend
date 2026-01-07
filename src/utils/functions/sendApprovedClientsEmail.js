require("dotenv").config();
const fs = require("fs").promises;
const path = require("path");

const emailService = require("../../services/EmailService");
const { getApprovedParticipants2025 } = require("./ParticipantService");

async function sendEmails() {
  try {
    // 1️⃣ Buscar participantes
    const participants = await getApprovedParticipants2025();

    console.log(
      `📨 Encontrados ${participants.length} participantes aprovados`
    );

    if (!participants.length) return;

    // 2️⃣ Ler template
    const templatePath = path.join(
      __dirname,
      "../../templates/eventMessageSale.html"
    );

    const rawTemplate = await fs.readFile(templatePath, "utf-8");

    // 3️⃣ Loop de envio
    for (const participant of participants) {
      let html = rawTemplate;

      // (opcional) personalização
      if (participant.name) {
        html = html.replace(/{{nome}}/g, participant.name);
      }

      await emailService.sendEmail({
        from: process.env.EMAIL_USER_1,
        to: participant.participants[0].email,
        subject:
          "Congresso Autismo MA 2026 — você é nosso convidado especial 💙",
        html,
        attachments: [],
      });

      console.log(`✅ Email enviado para ${participant.email}`);
    }

    console.log("🎉 Envio finalizado!");
  } catch (error) {
    console.error("❌ Erro no envio em massa:", error);
  }
}

sendEmails();

// node .\src\utils\functions\sendApprovedClientsEmail.js
