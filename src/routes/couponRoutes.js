const express = require("express");
const router = express.Router();
const CertificateController = require("../controllers/CertificateController");

router.post("/generate", CertificateController.generateCertificate);

module.exports = router;
