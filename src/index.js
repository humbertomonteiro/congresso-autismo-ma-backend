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

const PORT = config.port || 5000;
const server = app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

server.on("error", (err) => {
  console.error("Erro ao iniciar o servidor:", err.message);
});
