const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const config = require("./config");
const paymentRoutes = require("./routes/paymentRoutes");
const emailRoutes = require("./routes/emailRoutes");
const credentialRoutes = require("./routes/credentialRoutes");
const certificateRoutes = require("./routes/certificateRoutes");
const clientRegistrationRoutes = require("./routes/clientRegistrationRoutes");

const responseMiddleware = require("./middleware/response");
const path = require("path");
const { cleanupBoletos } = require("./jobs/cleanup");
const { verifyPendingPayments } = require("./jobs/verifyPayments");

const multerDebug = (req, res, next) => {
  console.log("=== MULTER DEBUG (REAL) ===");
  console.log("Body keys:", Object.keys(req.body));
  console.log("Files keys:", req.files ? Object.keys(req.files) : null);
  console.log("==========================");
  next();
};

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(responseMiddleware);
app.use(express.urlencoded({ extended: true }));

const boletoDir = path.join(__dirname, "temp");
app.use("/boletos", express.static(boletoDir));

// Rota de saúde
app.get("/", (req, res) => {
  res.sendResponse(200, true, "OK");
});

app.use("/api/payments", paymentRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/credentials", credentialRoutes);
app.use("/api/certificate", certificateRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/client", multerDebug, clientRegistrationRoutes);

cleanupBoletos();
verifyPendingPayments();

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
