const express = require("express");
const router = express.Router();
const emailController = require("../controllers/EmailController");

// Rotas de envio de email
router.post("/send-confirmation-email", emailController.sendEmail);
router.post(
  "/send-template-immediately",
  emailController.sendTemplateImmediately
);

router.get("/stats", emailController.getEmailStats);
router.get("/checkouts/count", emailController.getCheckoutCount);

// Rotas de gerenciamento de templates
router.post("/templates", emailController.generateEmailTemplate);
router.get("/templates", emailController.getTemplates);
router.put("/templates/:templateId", emailController.updateTemplate);
router.delete("/templates/:templateId", emailController.deleteTemplate);

// Rotas de listas de contatos (mantidas por enquanto)
router.post("/contact-lists", emailController.createContactList);
router.post(
  "/contact-lists/:listId/contacts",
  emailController.addContactToList
);

module.exports = router;
