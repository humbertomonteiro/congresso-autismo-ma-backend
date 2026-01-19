const emailService = require("./src/services/EmailService");

const templateData = {
  templateId: "eventMessageSale",
  status: "test",
};

emailService
  .sendPostEventEmailsToApproved(templateData)
  .then((result) => console.log(result))
  .catch((error) => console.error(error));
