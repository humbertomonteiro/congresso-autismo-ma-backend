const fs = require("fs").promises;
const path = require("path");
const EmailService = require("../../services/EmailService");

async function createTemplate() {
  const templatePath = path.resolve(
    __dirname,
    "../../templates/eventMessageSale.html"
  );

  const html = await fs.readFile(templatePath, "utf-8");

  await EmailService.createTemplateByStatus({
    title: "Convite Congresso Autismo MA 2026",
    subject: "Congresso Autismo MA 2026 — você é nosso convidado especial 💙",
    body: html,
    statusFilter: "approved",
    includeQRCodes: false,
  });

  console.log("✅ Template criado com sucesso");
}

createTemplate();

// node .\src\utils\functions\sendApprovedClientsEmail.js
