const ClientRegistrationService = require("../services/ClientRegistrationService");

class ClientRegistrationController {
  async registerClient(req, res) {
    const startTime = Date.now();

    try {
      console.log("\n" + "=".repeat(60));
      console.log("📥 INICIANDO PROCESSAMENTO DE CADASTRO");
      console.log("=".repeat(60));

      // Log da requisição
      console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
      console.log(`📦 Content-Type: ${req.headers["content-type"]}`);
      console.log(`📊 Body keys: ${Object.keys(req.body).join(", ")}`);

      // 1. PROCESSAR DADOS DO FORMULÁRIO
      console.log("\n🔍 PROCESSANDO DADOS DO FORMULÁRIO");
      let formData;

      // CASO 1: JSON puro (application/json)
      if (req.headers["content-type"]?.includes("application/json")) {
        formData = req.body;
        console.log("✅ Recebido como JSON puro");
      }
      // CASO 2: Form-data com campo 'dados'
      else if (req.body.dados) {
        try {
          formData =
            typeof req.body.dados === "string"
              ? JSON.parse(req.body.dados)
              : req.body.dados;
          console.log("✅ Recebido como form-data com campo 'dados'");
        } catch (parseError) {
          console.error("❌ Erro ao parsear JSON:", parseError.message);
          throw new Error(
            `Formato inválido no campo 'dados': ${parseError.message}`
          );
        }
      }
      // CASO 3: Form-data com campos individuais
      else {
        formData = req.body;
        console.log("✅ Recebido como form-data com campos individuais");

        // Tratar campos que podem vir como array (terapias)
        if (formData.terapias && typeof formData.terapias === "string") {
          try {
            formData.terapias = JSON.parse(formData.terapias);
          } catch {
            // Se não for JSON válido, mantém como string
          }
        }
      }

      // Log dos dados recebidos (resumido para não poluir)
      console.log(`📋 Total de campos: ${Object.keys(formData).length}`);
      console.log(`👶 Cliente: ${formData.nomeCliente || "Não informado"}`);
      console.log(`🔢 CPF: ${formData.cpfCliente || "Não informado"}`);

      // 2. PROCESSAR ARQUIVOS
      console.log("\n🔍 PROCESSANDO ARQUIVOS");
      let assinaturaDigital = null;
      let documentos = [];

      if (req.files) {
        console.log(
          `📎 Estrutura de files: ${Object.keys(req.files).join(", ")}`
        );

        // Assinatura Digital
        if (req.files.assinaturaDigital) {
          const file = Array.isArray(req.files.assinaturaDigital)
            ? req.files.assinaturaDigital[0]
            : req.files.assinaturaDigital;

          assinaturaDigital = file;
          console.log(
            `✅ Assinatura: ${file.originalname} (${file.size} bytes, ${file.mimetype})`
          );
        } else {
          console.log("ℹ️  Nenhuma assinatura digital recebida");
        }

        // Documentos
        if (req.files.documentos) {
          documentos = Array.isArray(req.files.documentos)
            ? req.files.documentos
            : [req.files.documentos];

          console.log(`✅ Documentos: ${documentos.length} arquivo(s)`);
          documentos.forEach((doc, index) => {
            console.log(
              `   ${index + 1}. ${doc.originalname} (${doc.size} bytes)`
            );
          });
        } else {
          console.log("ℹ️  Nenhum documento adicional recebido");
        }
      } else {
        console.log("ℹ️  Nenhum arquivo recebido na requisição");
      }

      // 3. VALIDAÇÃO BÁSICA
      console.log("\n🔍 VALIDAÇÃO INICIAL");
      if (!formData.nomeCliente || !formData.cpfCliente) {
        throw new Error("Nome e CPF do cliente são obrigatórios");
      }
      console.log("✅ Dados mínimos validados");

      // 4. CHAMAR SERVICE
      console.log("\n🔧 CHAMANDO SERVICE PARA PROCESSAMENTO");
      const result = await ClientRegistrationService.processRegistration(
        formData,
        { assinaturaDigital, documentos }
      );

      // 5. CALCULAR TEMPO DE PROCESSAMENTO
      const processingTime = Date.now() - startTime;

      // 6. RETORNAR RESPOSTA
      console.log("\n" + "=".repeat(60));
      console.log("✅ CADASTRO CONCLUÍDO COM SUCESSO");
      console.log("=".repeat(60));
      console.log(`⏱️  Tempo total: ${processingTime}ms`);
      console.log(`🆔 ID do Cliente: ${result.clienteId}`);
      console.log(`📎 Total de arquivos: ${result.totalArquivos}`);
      console.log(
        `🗄️  Status Google Sheets: ${result.googleSheetsRow || "Não enviado"}`
      );
      console.log("=".repeat(60) + "\n");

      return res.status(201).json({
        success: true,
        message: "Cadastro realizado com sucesso!",
        processingTime: `${processingTime}ms`,
        data: {
          clienteId: result.clienteId,
          totalArquivos: result.totalArquivos,
          googleSheetsRow: result.googleSheetsRow || "Salvo localmente",
          localPath:
            result.localPath || `/uploads/clientes/${result.clienteId}/`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      // CALCULAR TEMPO ATÉ O ERRO
      const errorTime = Date.now() - startTime;

      console.error("\n" + "❌".repeat(30));
      console.error("ERRO NO PROCESSAMENTO DO CADASTRO");
      console.error("❌".repeat(30));
      console.error(`⏱️  Tempo até erro: ${errorTime}ms`);
      console.error(`💥 Erro: ${error.message}`);
      console.error(`📌 Stack: ${error.stack}`);
      console.error("❌".repeat(30) + "\n");

      // Determinar status code apropriado
      let statusCode = 500;
      let errorMessage =
        error.message || "Erro ao processar cadastro do cliente.";

      if (
        error.message.includes("obrigatórios") ||
        error.message.includes("inválido") ||
        error.message.includes("Formato")
      ) {
        statusCode = 400; // Bad Request
      }

      return res.status(statusCode).json({
        success: false,
        error: errorMessage,
        processingTime: `${errorTime}ms`,
        timestamp: new Date().toISOString(),
        details:
          process.env.NODE_ENV === "development"
            ? {
                stack: error.stack,
                receivedData: req.body ? Object.keys(req.body) : "Nenhum dado",
                receivedFiles: req.files
                  ? Object.keys(req.files)
                  : "Nenhum arquivo",
              }
            : undefined,
      });
    }
  }

  async getAllClients(req, res) {
    try {
      console.log(`📋 Listando todos os clientes...`);
      const clients = await ClientRegistrationService.getAllClients();

      console.log(`✅ Encontrados ${clients.length} clientes`);
      return res.status(200).json({
        success: true,
        data: clients,
        count: clients.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Erro ao buscar clientes:", error);
      return res.status(500).json({
        success: false,
        error: "Erro ao buscar lista de clientes.",
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getClientById(req, res) {
    try {
      const { id } = req.params;
      console.log(`🔍 Buscando cliente por ID: ${id}`);

      const client = await ClientRegistrationService.getClientById(id);

      if (!client) {
        console.warn(`⚠️  Cliente não encontrado: ${id}`);
        return res.status(404).json({
          success: false,
          error: "Cliente não encontrado.",
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`✅ Cliente encontrado: ${client.nomeCliente || id}`);
      return res.status(200).json({
        success: true,
        data: client,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Erro ao buscar cliente:", error);
      return res.status(500).json({
        success: false,
        error: "Erro ao buscar dados do cliente.",
        timestamp: new Date().toISOString(),
      });
    }
  }

  async updateClientStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      console.log(`🔄 Atualizando status do cliente ${id} para: ${status}`);

      if (!status || typeof status !== "string") {
        return res.status(400).json({
          success: false,
          error: "Status é obrigatório e deve ser uma string.",
          timestamp: new Date().toISOString(),
        });
      }

      const updated = await ClientRegistrationService.updateStatus(id, status);

      if (!updated) {
        console.warn(`⚠️  Cliente não encontrado para atualização: ${id}`);
        return res.status(404).json({
          success: false,
          error: "Cliente não encontrado.",
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`✅ Status atualizado para: ${status}`);
      return res.status(200).json({
        success: true,
        message: "Status atualizado com sucesso!",
        data: updated,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Erro ao atualizar status:", error);
      return res.status(500).json({
        success: false,
        error: "Erro ao atualizar status do cliente.",
        timestamp: new Date().toISOString(),
      });
    }
  }

  // NOVO MÉTODO: Estatísticas do sistema
  async getStats(req, res) {
    try {
      console.log("📈 Gerando estatísticas do sistema...");

      // Esta função precisa ser implementada no Service
      const stats = await ClientRegistrationService.getSystemStats();

      return res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Erro ao buscar estatísticas:", error);
      return res.status(500).json({
        success: false,
        error: "Erro ao buscar estatísticas do sistema.",
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new ClientRegistrationController();
