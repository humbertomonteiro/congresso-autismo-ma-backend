// backend/src/controllers/EmailController.js
const EmailService = require("../services/EmailService");
const axios = require("axios");
require("dotenv").config();

const sendEmail = async (req, res) => {
  const { from, to, subject, data } = req.body;

  try {
    const result = await EmailService.sendManualEmail({
      from,
      to,
      subject,
      data,
    });
    res.sendResponse(200, true, "Email enviado com sucesso");
  } catch (error) {
    console.error(
      "Erro ao processar envio de email:",
      error.message,
      error.stack
    );
    res.sendResponse(500, false, "Erro ao enviar email", null, error.message);
  }
};

const generateEmailTemplate = async (req, res) => {
  const { status, theme } = req.body;

  try {
    if (!status || !theme) throw new Error("Status e tema são obrigatórios.");

    const template = await EmailService.generateEmailTemplate(status, theme);
    res.sendResponse(200, true, "Template gerado com sucesso", template);
  } catch (error) {
    console.error("Erro ao gerar template com IA:", error.message, error.stack);
    res.sendResponse(
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
    if (!templateId) throw new Error("ID do template é obrigatório.");

    await EmailService.sendTemplateImmediately(templateId);
    res.sendResponse(200, true, "Template enviado imediatamente com sucesso");
  } catch (error) {
    console.error(
      "Erro ao enviar template imediatamente:",
      error.message,
      error.stack
    );
    res.sendResponse(
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

    const list = await EmailService.createContactList(name, description);
    res.sendResponse(200, true, "Lista criada com sucesso", list);
  } catch (error) {
    console.error("Erro ao criar lista de contatos:", error.message);
    res.sendResponse(
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

    await EmailService.addContactToList(listId, email);
    res.sendResponse(200, true, "Contato adicionado com sucesso");
  } catch (error) {
    console.error("Erro ao adicionar contato à lista:", error.message);
    res.sendResponse(
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
