const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const paymentRoutes = require("./routes/paymentRoutes");
const emailService = require("./services/emailService");
const { sendResponse } = require("./utils/response");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

app.use("/api/payments", paymentRoutes);

emailService.startEmailService();

app.use((err, req, res, next) => {
  console.error("Erro no servidor:", err.stack);
  sendResponse(res, 500, false, "Erro interno no servidor.", null, err.message);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
