const express = require("express");
const multer = require("multer");
const ClientRegistrationController = require("../controllers/ClientRegistrationController");

const router = express.Router();

// Configuração do multer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por arquivo
    files: 12, // Total máximo de arquivos
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "text/plain",
    ];

    console.log(
      `📎 Verificando arquivo: ${file.originalname} (${file.mimetype})`
    );

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.warn(`⚠️  Tipo de arquivo rejeitado: ${file.mimetype}`);
      cb(
        new Error(
          `Tipo de arquivo não permitido: ${
            file.mimetype
          }. Tipos permitidos: ${allowedMimes.join(", ")}`
        ),
        false
      );
    }
  },
});

// Middleware para logging das requisições
const requestLogger = (req, res, next) => {
  console.log("\n=== NOVA REQUISIÇÃO ===");
  console.log(`📨 ${req.method} ${req.originalUrl}`);
  console.log(`🕐 ${new Date().toISOString()}`);
  console.log(`📦 Content-Type: ${req.headers["content-type"]}`);
  console.log(
    `👤 User-Agent: ${req.headers["user-agent"]?.substring(0, 50)}...`
  );
  next();
};

// Middleware para logar os arquivos recebidos
const fileLogger = (req, res, next) => {
  if (req.files) {
    console.log("📎 ARQUIVOS RECEBIDOS:");
    Object.keys(req.files).forEach((fieldName) => {
      const files = req.files[fieldName];
      if (Array.isArray(files)) {
        files.forEach((file, index) => {
          console.log(
            `  ${fieldName}[${index}]: ${file.originalname} (${file.size} bytes)`
          );
        });
      } else {
        console.log(
          `  ${fieldName}: ${files.originalname} (${files.size} bytes)`
        );
      }
    });
  } else {
    console.log("📎 Nenhum arquivo recebido");
  }

  if (req.body && Object.keys(req.body).length > 0) {
    console.log("📊 CAMPOS DE TEXTO RECEBIDOS:", Object.keys(req.body));
  }

  console.log("=======================\n");
  next();
};

// Middleware para tratamento de erros do multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("❌ Erro do Multer:", err.code);

    let message = "Erro no upload de arquivos";
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        message = "Arquivo muito grande. Máximo permitido: 10MB";
        break;
      case "LIMIT_FILE_COUNT":
        message = "Muitos arquivos. Máximo permitido: 12 arquivos";
        break;
      case "LIMIT_FIELD_KEY":
        message = "Nome do campo muito longo";
        break;
      case "LIMIT_UNEXPECTED_FILE":
        message = "Campo de arquivo não esperado";
        break;
    }

    return res.status(400).json({
      success: false,
      error: message,
      details: err.code,
    });
  } else if (err) {
    console.error("❌ Erro no upload:", err.message);
    return res.status(400).json({
      success: false,
      error: err.message || "Erro no upload de arquivos",
    });
  }
  next();
};

// ROTA DE TESTE (para debug)
router.post("/test", requestLogger, upload.any(), fileLogger, (req, res) => {
  res.json({
    success: true,
    message: "Teste de upload bem-sucedido!",
    received: {
      bodyFields: Object.keys(req.body),
      fileCount: req.files ? req.files.length : 0,
      files: req.files
        ? req.files.map((f) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            size: f.size,
            mimetype: f.mimetype,
          }))
        : [],
    },
  });
});

// ROTA PRINCIPAL DE CADASTRO
router.post(
  "/register",
  requestLogger,
  upload.fields([
    { name: "assinaturaDigital", maxCount: 1 },
    { name: "documentos", maxCount: 11 },
  ]),
  fileLogger,
  handleMulterError,
  ClientRegistrationController.registerClient
);

// ROTAS ADICIONAIS (para futuro)
router.get("/clients", ClientRegistrationController.getAllClients);
router.get("/clients/:id", ClientRegistrationController.getClientById);
router.patch(
  "/clients/:id/status",
  ClientRegistrationController.updateClientStatus
);

// Rota de saúde da API
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Client Registration API",
    version: "1.0.0",
  });
});

module.exports = router;
