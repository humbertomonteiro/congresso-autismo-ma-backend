const EmailService = require("../services/EmailService");
const CampaignService = require("../services/CampaignService");
const AudienceService = require("../services/AudienceService");

// ── Stats ─────────────────────────────────────────────────────────────────

const getEmailStats = async (req, res) => {
  try {
    const stats = await EmailService.getEmailStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Erro ao buscar estatísticas",
        error: error.message,
      });
  }
};

// ── Email de confirmação individual ───────────────────────────────────────

const sendConfirmationEmail = async (req, res) => {
  const { checkoutId, participantId, data } = req.body;
  try {
    if (!checkoutId || !participantId) {
      throw new Error("checkoutId e participantId são obrigatórios.");
    }
    const result = await EmailService.sendEmailConfirmationPayment({
      checkoutId,
      participantId,
      data,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Erro ao enviar email",
        error: error.message,
      });
  }
};

// ── Audiências ────────────────────────────────────────────────────────────

const createAudience = async (req, res) => {
  try {
    const { name, description, filters } = req.body;
    const audienceId = await AudienceService.createAudience({
      name,
      description,
      filters,
    });
    res
      .status(201)
      .json({
        success: true,
        message: "Audiência criada",
        data: { audienceId },
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAudiences = async (req, res) => {
  try {
    const audiences = await AudienceService.getAllAudiences();
    res.status(200).json({ success: true, data: audiences });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateAudience = async (req, res) => {
  try {
    const { audienceId } = req.params;
    await AudienceService.updateAudience(audienceId, req.body);
    res.status(200).json({ success: true, message: "Audiência atualizada" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteAudience = async (req, res) => {
  try {
    const { audienceId } = req.params;
    await AudienceService.deleteAudience(audienceId);
    res.status(200).json({ success: true, message: "Audiência deletada" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const estimateAudienceSize = async (req, res) => {
  try {
    const { audienceId } = req.params;
    const count = await AudienceService.estimateAudienceSize(audienceId);
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Campanhas ─────────────────────────────────────────────────────────────

const createCampaign = async (req, res) => {
  try {
    const { name, audienceId, subject, htmlBody, includeTicket, sendOnNew } =
      req.body;
    const campaignId = await CampaignService.createCampaign({
      name,
      audienceId,
      subject,
      htmlBody,
      includeTicket,
      sendOnNew,
    });
    res
      .status(201)
      .json({
        success: true,
        message: "Campanha criada",
        data: { campaignId },
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCampaigns = async (req, res) => {
  try {
    const campaigns = await CampaignService.getAllCampaigns();
    res.status(200).json({ success: true, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    await CampaignService.updateCampaign(campaignId, req.body);
    res.status(200).json({ success: true, message: "Campanha atualizada" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    await CampaignService.deleteCampaign(campaignId);
    res.status(200).json({ success: true, message: "Campanha deletada" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const dispatchCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result = await CampaignService.dispatchCampaign(campaignId);
    res
      .status(200)
      .json({ success: true, message: "Campanha disparada", data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCampaignLogs = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { limit } = req.query;
    const logs = await CampaignService.getCampaignLogs(
      campaignId,
      limit ? parseInt(limit) : 100
    );
    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getEmailStats,
  sendConfirmationEmail,
  // Audiências
  createAudience,
  getAudiences,
  updateAudience,
  deleteAudience,
  estimateAudienceSize,
  // Campanhas
  createCampaign,
  getCampaigns,
  updateCampaign,
  deleteCampaign,
  dispatchCampaign,
  getCampaignLogs,
};
