const axios = require("axios");

class GoogleAppsScriptService {
  constructor() {
    this.webAppUrl = process.env.GOOGLE_WEB_APP_URL;
    this.timeout = 30000; // 30 segundos para uploads
  }

  // Converte buffer para base64
  bufferToBase64(buffer) {
    return buffer.toString("base64");
  }

  // Prepara arquivos para envio ao Apps Script
  prepareFilesForUpload(files, clienteId) {
    const prepared = {
      assinatura: null,
      documentos: [],
    };

    // Preparar assinatura
    if (files.assinaturaDigital?.buffer) {
      prepared.assinatura = {
        base64: this.bufferToBase64(files.assinaturaDigital.buffer),
        fileName: `assinatura_${clienteId}_${Date.now()}.png`,
        mimeType: files.assinaturaDigital.mimetype || "image/png",
      };
    }

    // Preparar documentos
    if (files.documentos?.length > 0) {
      for (const [index, doc] of files.documentos.entries()) {
        if (!doc.buffer) continue;

        // Extrair extensão do nome original ou usar padrão
        let extension = ".pdf";
        if (doc.originalname.includes(".")) {
          extension = doc.originalname.substring(
            doc.originalname.lastIndexOf(".")
          );
        }

        prepared.documentos.push({
          base64: this.bufferToBase64(doc.buffer),
          fileName: `documento_${clienteId}_${
            index + 1
          }_${Date.now()}${extension}`,
          mimeType: doc.mimetype || "application/octet-stream",
        });
      }
    }

    return prepared;
  }

  // Processamento COMPLETO: envia tudo de uma vez
  async processComplete(formData, files) {
    try {
      console.log("🚀 ENVIANDO TUDO PARA GOOGLE (Sheets + Drive)");

      // Gerar ID do cliente
      const clienteId = this.generateClientId(formData.cpfCliente);
      console.log(`   📋 ID Cliente: ${clienteId}`);

      // Preparar dados
      const uploadData = {
        tipo: "complete",
        clienteId: clienteId,
        formData: formData,
        files: this.prepareFilesForUpload(files, clienteId),
      };

      console.log(`   📤 Enviando dados completos...`);
      console.log(`   📊 Campos: ${Object.keys(formData).length}`);
      console.log(
        `   📎 Arquivos: ${
          uploadData.files.documentos.length +
          (uploadData.files.assinatura ? 1 : 0)
        }`
      );

      const response = await axios.post(this.webAppUrl, uploadData, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: this.timeout,
      });

      console.log(
        `   ✅ Resposta do Google:`,
        response.data.message || "Processado"
      );

      return {
        success: true,
        clienteId: clienteId,
        response: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`   ❌ Erro no processamento completo: ${error.message}`);

      if (error.response) {
        console.error(`   📋 Status: ${error.response.status}`);
        console.error(`   📜 Resposta:`, error.response.data);
      }

      return {
        success: false,
        error: error.message,
        message: "Falha no processamento completo no Google",
        fallback: false,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Apenas Sheets (para compatibilidade)
  async sendToSheets(formData) {
    try {
      console.log("📊 ENVIANDO APENAS PARA SHEETS");

      const sheetsData = {
        tipo: "sheets_only",
        ...formData,
      };

      const response = await axios.post(this.webAppUrl, sheetsData, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000,
      });

      return {
        success: true,
        response: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`   ❌ Erro ao enviar para Sheets: ${error.message}`);
      return {
        success: false,
        error: error.message,
        fallback: true,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Apenas Drive (para casos específicos)
  async uploadToDrive(files, clienteId) {
    try {
      console.log("📁 ENVIANDO APENAS PARA DRIVE");

      const driveData = {
        tipo: "upload_drive",
        clienteId: clienteId,
        files: this.prepareFilesForUpload(files, clienteId),
      };

      const response = await axios.post(this.webAppUrl, driveData, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: this.timeout,
      });

      return {
        success: true,
        response: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`   ❌ Erro no upload para Drive: ${error.message}`);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Gerar ID do cliente (mesmo do Apps Script)
  generateClientId(cpf) {
    if (!cpf) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 10).toUpperCase();
      return `CLI-TEMP-${timestamp
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}-${random}`;
    }

    const cleanCPF = cpf.replace(/\D/g, "");
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `CLI-${cleanCPF.substring(0, 3)}-${timestamp
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}-${random}`;
  }

  // Teste de conexão
  async testConnection() {
    console.log("\n🧪 TESTE DE CONEXÃO COM GOOGLE APPS SCRIPT");
    console.log(`URL: ${this.webAppUrl}`);

    if (!this.webAppUrl) {
      console.log("❌ URL não configurada no .env");
      return false;
    }

    try {
      const response = await axios.get(this.webAppUrl, {
        timeout: 10000,
      });

      console.log("✅ Conexão bem-sucedida!");
      console.log("📝 Status:", response.data.status || "online");
      console.log("📊 Planilha:", response.data.planilha?.nome || "N/A");
      console.log(
        "📁 Drive:",
        response.data.drive?.disponivel ? "Disponível" : "Não disponível"
      );
      return true;
    } catch (error) {
      console.error("❌ Falha na conexão:", error.message);
      return false;
    }
  }
}

module.exports = new GoogleAppsScriptService();
