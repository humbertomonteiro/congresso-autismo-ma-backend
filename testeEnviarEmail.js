const emailService = require("./src/services/EmailService");

const templateData = {
  templateId: "eventMessageSale",
  status: "approved",
};

emailService
  .sendPostEventEmailsToApproved(templateData)
  .then((result) => console.log(result))
  .catch((error) => console.error(error));
