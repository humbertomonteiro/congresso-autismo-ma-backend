const fs = require("fs").promises;
const { generateCertificatePDF } = require("../utils/templateUtils");

class CertificateService {
  async generateCertificate(cpf, name) {
    if (!cpf || !name) {
      throw new Error("CPF e nome são obrigatórios.");
    }

    try {
      // Normaliza o CPF (remove pontos e traços)
      const normalizedCpf = cpf.replace(/[\.-]/g, "");
      // Gera o PDF
      const pdfPath = await generateCertificatePDF(normalizedCpf, name);
      // Lê o arquivo PDF como buffer
      const pdfBuffer = await fs.readFile(pdfPath);
      // Remove o arquivo temporário
      await fs
        .unlink(pdfPath)
        .catch((err) =>
          console.warn("Erro ao remover arquivo temporário:", err)
        );

      return {
        buffer: pdfBuffer,
        fileName: `certificado_${normalizedCpf}_${name.replace(
          /\s/g,
          "_"
        )}.pdf`,
      };
    } catch (error) {
      console.error("Erro no CertificateService:", error);
      throw new Error("Falha ao gerar o certificado.");
    }
  }
}

module.exports = new CertificateService();
