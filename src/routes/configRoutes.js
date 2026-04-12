const express = require("express");
const router = express.Router();
const { verifyToken, requireAdm } = require("../middleware/authMiddleware");
const c = require("../controllers/ConfigController");

// Leitura pública (clientes autenticados no Firebase podem ler via onSnapshot direto,
// mas este endpoint serve como fallback e para admin)
router.get("/event", c.getEventConfig);

// Escrita: exige token Firebase válido E role === 'adm'
router.put("/event", verifyToken, requireAdm, c.updateEventConfig);

// Histórico de alterações: só adm
router.get("/event/audit", verifyToken, requireAdm, c.getAuditLog);

module.exports = router;
