// services/GoogleSheetsService.js - ATUALIZADO
const axios = require("axios");

class GoogleSheetsService {
  constructor() {
    this.webAppUrl = process.env.GOOGLE_WEB_APP_URL;
    this.timeout = 20000;
  }

  async saveData(formData) {
    if (!this.webAppUrl) {
      console.log("   ℹ️  URL do Google Web App não configurada");
      return {
        success: false,
        message: "Google Sheets não configurado",
        fallback: true,
      };
    }

    console.log(`   🌐 Enviando para Google Sheets...`);

    // Preparar dados NA ORDEM EXATA das colunas
    const dadosParaEnvio = {
      // ORDEM EXATA conforme sua planilha
      nomeCliente: formData.nomeCliente || "",
      cpfCliente: formData.cpfCliente || "",
      dataNascimentoCliente: formData.dataNascimentoCliente || "",
      tipoSanguineo: formData.tipoSanguineo || "",
      diagnostico: formData.diagnostico || "",
      sexo: formData.sexo || "",
      operadoraSaude: formData.operadoraSaude || "",
      coparticipacao: formData.coparticipacao || "",
      nomeMae: formData.nomeMae || "",
      rgMae: formData.rgMae || "",
      cpfMae: formData.cpfMae || "",
      dataNascimentoMae: formData.dataNascimentoMae || "",
      profissaoMae: formData.profissaoMae || "",
      nomePai: formData.nomePai || "",
      rgPai: formData.rgPai || "",
      cpfPai: formData.cpfPai || "",
      dataNascimentoPai: formData.dataNascimentoPai || "",
      profissaoPai: formData.profissaoPai || "",
      terapias: formData.terapias || "", // Já vem como string do ClientService
      logradouro: formData.logradouro || "",
      numero: formData.numero || "",
      bairro: formData.bairro || "",
      complemento: formData.complemento || "",
      cep: formData.cep || "",
      cidade: formData.cidade || "",
      estado: formData.estado || "",
      telefoneResidencial: formData.telefoneResidencial || "",
      telefoneMae: formData.telefoneMae || "",
      telefonePai: formData.telefonePai || "",
      telefoneRecado: formData.telefoneRecado || "",
      emergenciaContato: formData.emergenciaContato || "",
      autorizacao: formData.autorizacao || "",
      assinaturaUrl: formData.assinaturaUrl || "",
      documentosUrls: formData.documentosUrls || "",
    };

    console.log(`   📤 Enviando ${Object.keys(dadosParaEnvio).length} campos`);
    console.log(`   👶 Cliente: ${dadosParaEnvio.nomeCliente}`);

    try {
      const response = await axios.post(this.webAppUrl, {
        tipo: "sheets_only",
        formData: dadosParaEnvio,
      });

      console.log(`   ✅ Resposta do Google:`, response.data);

      return {
        success: true,
        message: "Dados enviados para Google Sheets",
        response: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`   ❌ Erro ao enviar: ${error.message}`);

      if (error.response) {
        console.error(`   📋 Status: ${error.response.status}`);
        console.error(`   📜 Resposta:`, error.response.data);
      }

      return {
        success: false,
        error: error.message,
        message: "Falha ao enviar para Google Sheets",
        fallback: true,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Teste de conexão melhorado
  async testConnection() {
    console.log("\n🧪 TESTE DE CONEXÃO COM GOOGLE SHEETS");
    console.log(`URL: ${this.webAppUrl}`);

    if (!this.webAppUrl) {
      console.log("❌ URL não configurada no .env");
      return false;
    }

    const testData = {
      nomeCliente: "TESTE CONEXAO",
      cpfCliente: "999.888.777-00",
      diagnostico: "Teste de conexão",
      sexo: "MASCULINO",
      nomeMae: "Mãe Teste",
      cpfMae: "111.222.333-44",
      telefoneMae: "(11) 99999-9999",
      emergenciaContato: "Teste",
      autorizacao: "SIM",
    };

    try {
      console.log("📤 Enviando dados de teste...");
      const response = await axios.post(this.webAppUrl, testData, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      console.log("✅ Conexão bem-sucedida!");
      console.log("📝 Resposta:", response.data);
      return true;
    } catch (error) {
      console.error("❌ Falha na conexão:", error.message);
      if (error.response) {
        console.error("Detalhes:", error.response.data);
      }
      return false;
    }
  }
}

module.exports = new GoogleSheetsService();
