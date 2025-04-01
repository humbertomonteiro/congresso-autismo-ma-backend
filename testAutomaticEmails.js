// const EmailService = require("./src/services/EmailService");

// async function testAutomaticEmails() {
//   try {
//     // Passo 1: Criar um template pro status "test"
//     const { templateId } = await EmailService.createTemplateByStatus({
//       subject: "Teste de Email Automático",
//       title: "Email de Teste",
//       body: "Este é um email de teste para o status 'test'!",
//       statusFilter: "test",
//       includeQRCodes: false, // Sem QR codes pra simplificar
//     });
//     console.log(`Template criado: ${templateId}`);

//     // Passo 2: Processar os emails automáticos
//     await EmailService.processAutomaticEmails([templateId]);
//     console.log("Emails automáticos processados com sucesso!");
//   } catch (error) {
//     console.error("Erro no teste:", error.message);
//   }
// }

// testAutomaticEmails();

const EmailService = require("./src/services/EmailService");

async function testAutomaticEmails() {
  try {
    const { templateId } = await EmailService.createTemplateByStatus({
      subject: "Teste com QR Codes",
      title: "Email de Teste com QR",
      body: "Aqui está seu QR code de teste!",
      statusFilter: "test",
      includeQRCodes: true,
    });
    console.log(`Template criado: ${templateId}`);

    await EmailService.processAutomaticEmails([templateId]);
    console.log("Emails automáticos com QR codes processados com sucesso!");
  } catch (error) {
    console.error("Erro no teste:", error.message);
  }
}

testAutomaticEmails();
