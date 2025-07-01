const emailService = require("./src/services/EmailService");

const templateData = {
  templateId: "emailTemplateLinkCertificate",
  status: "approved",
};

emailService
  .sendPostEventEmailsToApproved(templateData)
  .then((result) => console.log(result))
  .catch((error) => console.error(error));
