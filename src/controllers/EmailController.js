// backend/src/controllers/EmailController.js
const emailService = require("../services/emailService");
const { sendResponse } = require("../utils/response");
const axios = require("axios");
const {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
} = require("firebase/firestore");
const { db } = require("../config");
require("dotenv").config();

const fs = require("fs").promises;
const path = require("path");

const sendEmail = async (req, res) => {
  const { from, to, subject, data } = req.body;

  try {
    console.log("Recebendo requisição para enviar email:", {
      from,
      to,
      subject,
      data,
    });

    const missingFields = [];
    if (!from) missingFields.push("'from'");
    if (!to) missingFields.push("'to'");
    if (!subject) missingFields.push("'subject'");
    if (!data) missingFields.push("'data'");
    if (missingFields.length > 0) {
      throw new Error(
        `Campos obrigatórios faltando: ${missingFields.join(", ")}.`
      );
    }

    console.log("Lendo template HTML...");
    const templatePath = path.join(
      __dirname,
      "../templates/emailTemplate.html"
    );
    let htmlTemplate;
    try {
      htmlTemplate = await fs.readFile(templatePath, "utf-8");
      console.log("Template HTML lido com sucesso.");
    } catch (fileError) {
      console.error("Erro ao ler o arquivo de template:", fileError.message);
      throw new Error("Erro ao carregar o template de email.");
    }

    console.log("Substituindo placeholders no template...");
    htmlTemplate = htmlTemplate
      .replace("{{nome}}", data.name || "Participante")
      .replace("{{transactionId}}", data.transactionId || "N/A")
      .replace("{{fullTickets}}", data.fullTickets || 0)
      .replace("{{valueTicketsAll}}", data.valueTicketsAll || "0.00")
      .replace("{{halfTickets}}", data.halfTickets || 0)
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

    console.log("Enviando email via emailService...");
    await emailService.sendEmail({ from, to, subject, html: htmlTemplate });
    console.log("Email enviado com sucesso.");

    sendResponse(res, 200, true, "Email enviado com sucesso");
  } catch (error) {
    console.error(
      "Erro ao processar envio de email:",
      error.message,
      error.stack
    );
    sendResponse(res, 500, false, "Erro ao enviar email", null, error.message);
  }
};

const generateEmailTemplate = async (req, res) => {
  const { status, theme } = req.body;

  try {
    if (!status || !theme) {
      throw new Error("Status e tema são obrigatórios.");
    }

    console.log("Tentando gerar template com IA...");
    console.log("XAI_API_KEY:", process.env.XAI_API_KEY);

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

    console.log("Resposta da xAI:", xaiResponse.data);

    const generatedContent = xaiResponse.data.choices[0].message.content;
    const [subjectLine, ...bodyLines] = generatedContent.split("\n");
    const subject = subjectLine.replace("Subject: ", "").trim();
    const body = bodyLines.join("\n").replace("Body: ", "").trim();

    sendResponse(res, 200, true, "Template gerado com sucesso", {
      subject,
      body,
    });
  } catch (error) {
    console.error("Erro ao gerar template com IA:", error.message, error.stack);
    if (error.response) {
      console.error("Detalhes do erro da API:", error.response.data);
    }
    sendResponse(
      res,
      error.response?.status || 500,
      false,
      "Erro ao gerar o template com IA",
      null,
      error.message
    );
  }
};

const sendTemplateImmediately = async (req, res) => {
  const { templateId } = req.body;

  try {
    if (!templateId) {
      throw new Error("ID do template é obrigatório.");
    }

    await emailService.sendTemplateImmediately(templateId);
    sendResponse(res, 200, true, "Template enviado imediatamente com sucesso");
  } catch (error) {
    console.error(
      "Erro ao enviar template imediatamente:",
      error.message,
      error.stack
    );
    sendResponse(
      res,
      500,
      false,
      "Erro ao enviar template imediatamente",
      null,
      error.message
    );
  }
};

const createContactList = async (req, res) => {
  const { name, description } = req.body;

  try {
    if (!name) throw new Error("Nome da lista é obrigatório.");

    const listData = {
      name,
      description: description || "",
      contacts: [],
      createdAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "contactLists"), listData);
    sendResponse(res, 200, true, "Lista criada com sucesso", {
      id: docRef.id,
      ...listData,
    });
  } catch (error) {
    console.error("Erro ao criar lista de contatos:", error.message);
    sendResponse(
      res,
      500,
      false,
      "Erro ao criar lista de contatos",
      null,
      error.message
    );
  }
};

const addContactToList = async (req, res) => {
  const { listId, email } = req.body;

  try {
    if (!listId || !email)
      throw new Error("ID da lista e email são obrigatórios.");

    const listRef = doc(db, "contactLists", listId);
    const listDoc = await getDoc(listRef);
    if (!listDoc.exists()) throw new Error("Lista não encontrada.");

    const listData = listDoc.data();
    const updatedContacts = [...(listData.contacts || []), email];
    await updateDoc(listRef, { contacts: updatedContacts });

    sendResponse(res, 200, true, "Contato adicionado com sucesso");
  } catch (error) {
    console.error("Erro ao adicionar contato à lista:", error.message);
    sendResponse(
      res,
      500,
      false,
      "Erro ao adicionar contato à lista",
      null,
      error.message
    );
  }
};

module.exports = {
  sendEmail,
  generateEmailTemplate,
  sendTemplateImmediately,
  createContactList,
  addContactToList,
};
