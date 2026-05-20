const express = require("express");
const router = express.Router();
const CertificateController = require("../controllers/CertificateController");

router.post("/generate", CertificateController.generateCertificate);
router.post("/record", CertificateController.saveCertificateRecord);

module.exports = router;
