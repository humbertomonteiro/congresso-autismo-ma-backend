const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const paymentRoutes = require("./routes/paymentRoutes");
const emailService = require("./services/emailService");
const { sendResponse } = require("./utils/response");

dotenv.config();

const app = express();

// const corsOptions = {
//   origin: ["http://localhost:5173", "https://congressoautismoma.com.br"],
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   allowedHeaders: ["Content-Type", "Authorization"],
//   credentials: true,
// };

// app.use(cors(corsOptions));

// app.options("*", cors(corsOptions));

app.use(cors());

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.use("/api/payments", paymentRoutes);

emailService.startEmailService();

emailService.startQRCodeService();

app.use((err, req, res, next) => {
  console.error("Erro no servidor:", err.stack);
  sendResponse(res, 500, false, "Erro interno no servidor.", null, err.message);
});

const PORT = process.env.PORT || 5000;
app
  .listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  })
  .on("error", (err) => {
    console.error("Erro ao iniciar o servidor:", err.message);
  });
