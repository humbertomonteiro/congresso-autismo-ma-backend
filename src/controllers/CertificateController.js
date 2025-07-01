const CertificateService = require("../services/CertificateService");

class CertificateController {
  async generateCertificate(req, res) {
    try {
      //templateHTML: cientifica, monitoria, organizadora
      const { cpf, name, templateHTML } = req.body;

      // Chama o service para gerar o PDF
      const { buffer, fileName } = await CertificateService.generateCertificate(
        cpf,
        name,
        templateHTML
      );

      // Configura os cabeçalhos da resposta
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${fileName}`,
        "Content-Length": buffer.length,
      });

      // Envia o PDF
      res.send(buffer);
    } catch (error) {
      console.error("Erro no CertificateController:", error);
      res
        .status(500)
        .json({ error: error.message || "Erro ao gerar o certificado." });
    }
  }
}

module.exports = new CertificateController();
