// backend/src/controllers/EmailController.js
const EmailService = require("../services/EmailService");
require("dotenv").config();

const sendEmail = async (req, res) => {
  const { checkoutId, from, to, subject, data } = req.body;

  try {
    const result = await EmailService.sendEmailConfirmationPayment({
      checkoutId,
      from,
      to,
      subject,
      data,
    });
    res.status(200).json({
      success: true,
      message: "Email de confirmação enviado com sucesso",
    });
  } catch (error) {
    console.error(
      "Erro ao processar envio de email de confirmação:",
      error.message,
      error.stack
    );
    res.status(500).json({
      success: false,
      message: "Erro ao enviar email de confirmação",
      error: error.message,
    });
  }
};

const generateEmailTemplate = async (req, res) => {
  const {
    subject,
    title,
    body,
    sendType,
    singleEmail,
    statusFilter,
    includeQRCodes = false,
  } = req.body;

  try {
    if (!subject || !body || !sendType)
      throw new Error("Assunto, corpo e tipo de envio são obrigatórios");

    const templateData = {
      subject,
      title: title || "",
      body,
      sendType,
      singleEmail: sendType === "single" ? singleEmail : null,
      statusFilter: sendType === "status" ? statusFilter : null,
      includeQRCodes,
    };

    const { templateId } = await EmailService.createTemplateByStatus(
      templateData
    );
    res.status(201).json({
      success: true,
      message: "Template criado com sucesso",
      templateId,
    });
  } catch (error) {
    console.error("Erro ao criar template:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Erro ao criar template",
      error: error.message,
    });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await EmailService.getAllTemplates(); // Adicionar no EmailService
    res.status(200).json({ success: true, data: templates });
  } catch (error) {
    console.error("Erro ao listar templates:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Erro ao listar templates",
      error: error.message,
    });
  }
};

const updateTemplate = async (req, res) => {
  const { templateId } = req.params;
  const {
    subject,
    title,
    body,
    sendType,
    singleEmail,
    statusFilter,
    includeQRCodes,
  } = req.body;

  try {
    if (!templateId || !subject || !body || !sendType)
      throw new Error("ID, assunto, corpo e tipo de envio são obrigatórios");

    const templateData = {
      subject,
      title: title || "",
      body,
      sendType,
      singleEmail: sendType === "single" ? singleEmail : null,
      statusFilter: sendType === "status" ? statusFilter : null,
      includeQRCodes,
    };

    await EmailService.updateTemplate(templateId, templateData); // Adicionar no EmailService
    res
      .status(200)
      .json({ success: true, message: "Template atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar template:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar template",
      error: error.message,
    });
  }
};

const deleteTemplate = async (req, res) => {
  const { templateId } = req.params;

  try {
    if (!templateId) throw new Error("ID do template é obrigatório");

    await EmailService.deleteTemplate(templateId); // Adicionar no EmailService
    res
      .status(200)
      .json({ success: true, message: "Template deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar template:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: "Erro ao deletar template",
      error: error.message,
    });
  }
};

const sendTemplateImmediately = async (req, res) => {
  const { templateId } = req.body;

  try {
    if (!templateId) throw new Error("ID do template é obrigatório");

    await EmailService.processAutomaticEmails([templateId]); // Ajustado pra usar processAutomaticEmails
    res.status(200).json({
      success: true,
      message: "Template enviado imediatamente com sucesso",
    });
  } catch (error) {
    console.error(
      "Erro ao enviar template imediatamente:",
      error.message,
      error.stack
    );
    res.status(500).json({
      success: false,
      message: "Erro ao enviar template imediatamente",
      error: error.message,
    });
  }
};

const createContactList = async (req, res) => {
  const { name, description } = req.body;

  try {
    if (!name) throw new Error("Nome da lista é obrigatório");

    const list = await EmailService.createContactList(name, description);
    res
      .status(200)
      .json({ success: true, message: "Lista criada com sucesso", data: list });
  } catch (error) {
    console.error("Erro ao criar lista de contatos:", error.message);
    res.status(500).json({
      success: false,
      message: "Erro ao criar lista de contatos",
      error: error.message,
    });
  }
};

const addContactToList = async (req, res) => {
  const { listId, email } = req.body;

  try {
    if (!listId || !email)
      throw new Error("ID da lista e email são obrigatórios");

    await EmailService.addContactToList(listId, email);
    res
      .status(200)
      .json({ success: true, message: "Contato adicionado com sucesso" });
  } catch (error) {
    console.error("Erro ao adicionar contato à lista:", error.message);
    res.status(500).json({
      success: false,
      message: "Erro ao adicionar contato à lista",
      error: error.message,
    });
  }
};

const getEmailStats = async (req, res) => {
  try {
    const stats = await EmailService.getEmailStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar estatísticas",
      error: error.message,
    });
  }
};

const getCheckoutCount = async (req, res) => {
  const { status } = req.query;
  try {
    const checkouts = await CheckoutRepository.fetchCheckouts({ status });
    const targetCount =
      status === "approved"
        ? checkouts.reduce((sum, c) => sum + c.participants.length, 0)
        : checkouts.length;
    res.status(200).json({ success: true, data: { targetCount } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao contar checkouts",
      error: error.message,
    });
  }
};

module.exports = {
  sendEmail,
  generateEmailTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
  sendTemplateImmediately,
  createContactList,
  addContactToList,
  getEmailStats,
  getCheckoutCount,
};
