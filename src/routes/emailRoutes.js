// src/routes/emailRoutes.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/EmailController");

router.post("/send-email", emailController.sendEmail);
router.post("/generate-email-template", emailController.generateEmailTemplate);
router.post(
  "/send-template-immediately",
  emailController.sendTemplateImmediately
);

module.exports = router;
