const emailService = require("./src/services/EmailService");
emailService
  .sendTestEmails({
    subject:
      "Veja o Cronograma do evento e os seus ingressos | Congresso Autismo MA 2025",
  })
  .then((result) => console.log(result))
  .catch((error) => console.error(error));
