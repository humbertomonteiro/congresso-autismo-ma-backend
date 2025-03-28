const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const config = require("./config");
const paymentRoutes = require("./routes/paymentRoutes");
const emailRoutes = require("./routes/emailRoutes");
const credentialRoutes = require("./routes/credentialRoutes");
const emailService = require("./services/EmailService");
const responseMiddleware = require("./middleware/response");
const CheckoutService = require("./services/CheckoutService");
const cron = require("node-cron");

dotenv.config();

const app = express();

// const corsOptions = {
//   origin: ["http://localhost:5173", "https://congressoautismoma.com.br"],
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   allowedHeaders: ["Content-Type", "Authorization"],
//   credentials: true,
// };

app.use(cors());
// app.use(cors(corsOptions));
// app.options("*", cors(corsOptions));

app.use(express.json());

app.use(responseMiddleware);

// Rota de saúde
app.get("/", (req, res) => {
  res.sendResponse(200, true, "OK");
});

app.use("/api/payments", paymentRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/credentials", credentialRoutes);

emailService.startEmailService();
emailService.startQRCodeService();

cron.schedule("0 */6 * * *", () => {
  console.log(
    "[Server] Executando verificação automática de pagamentos pendentes..."
  );
  CheckoutService.verifyAllPendingPayments().catch((error) =>
    console.error("[Server] Erro na verificação automática:", error.message)
  );
});

app.use((err, req, res, next) => {
  console.error("Erro no servidor:", err.stack);
  res.sendResponse(500, false, "Erro interno no servidor", null, err.message);
});

// Função assíncrona para verificar e capturar pagamentos
// async function checkAndCapturePayments() {
//   const paymentIds = [
//     "c6aa5237-6e34-4c22-9aca-ce6222d42359", // Primeiro pagamento
//     "17408f25-ae5a-45ce-a922-d39cd0a95669", // Segundo pagamento
//   ];

//   for (const paymentId of paymentIds) {
//     try {
//       console.log(`Processando pagamento ${paymentId}...`);
//       const status = await CieloRepository.getPaymentStatus(paymentId);
//       console.log(`Status do pagamento ${paymentId}:`, status);

//       if (status.Status === 1) {
//         console.log(`Capturando pagamento ${paymentId}...`);
//         const captureResponse = await CieloRepository.capturePayment(
//           paymentId,
//           status.Amount
//         );
//         console.log(
//           `Pagamento ${paymentId} capturado com sucesso:`,
//           captureResponse
//         );

//         // Verifica o status após captura
//         const updatedStatus = await CieloRepository.getPaymentStatus(paymentId);
//         console.log(
//           `Status atualizado após captura para ${paymentId}:`,
//           updatedStatus
//         );
//       } else {
//         console.log(
//           `O pagamento ${paymentId} não está apto para captura. Status: ${status.Status}`
//         );
//       }
//     } catch (error) {
//       console.error(
//         `Erro ao processar o pagamento ${paymentId}:`,
//         error.message
//       );
//     }
//   }
// }

const PORT = config.port || 5000;
const server = app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

server.on("error", (err) => {
  console.error("Erro ao iniciar o servidor:", err.message);
});
