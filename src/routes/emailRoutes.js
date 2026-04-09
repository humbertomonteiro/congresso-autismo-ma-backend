const express = require("express");
const router = express.Router();
const c = require("../controllers/EmailController");

// Stats
router.get("/stats", c.getEmailStats);

// Email individual de confirmação
router.post("/send-confirmation", c.sendConfirmationEmail);

// Audiências
router.post("/audiences", c.createAudience);
router.get("/audiences", c.getAudiences);
router.put("/audiences/:audienceId", c.updateAudience);
router.delete("/audiences/:audienceId", c.deleteAudience);
router.get("/audiences/:audienceId/estimate", c.estimateAudienceSize);

// Campanhas
router.post("/campaigns", c.createCampaign);
router.get("/campaigns", c.getCampaigns);
router.put("/campaigns/:campaignId", c.updateCampaign);
router.delete("/campaigns/:campaignId", c.deleteCampaign);
router.post("/campaigns/:campaignId/dispatch", c.dispatchCampaign);
router.get("/campaigns/:campaignId/logs", c.getCampaignLogs);

module.exports = router;
