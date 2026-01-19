const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
require("dotenv").config();

class ClientRegistrationService {
  constructor() {
    this.uploadsDir = path.join(__dirname, "../uploads");
    this.clientsDir = path.join(this.uploadsDir, "clientes");
    this.webAppUrl = process.env.GOOGLE_WEB_APP_URL;

    // Garantir que os diretórios existam
    this.initDirectories();
  }

  async initDirectories() {
    try {
      await fs.mkdir(this.uploadsDir, { recursive: true });
      await fs.mkdir(this.clientsDir, { recursive: true });
      console.log("✅ Diretórios de upload inicializados");
    } catch (error) {
      console.error("❌ Erro ao criar diretórios:", error);
    }
  }

  async processRegistration(formData, files) {
    const startTime = Date.now();
    console.log("🔧 Iniciando processamento do cadastro...");

    try {
      // 1. Gerar ID único para o cliente
      const clienteId = `CLI-${Date.now()}-${uuidv4()
        .slice(0, 8)
        .toUpperCase()}`;
      const clienteDir = path.join(this.clientsDir, clienteId);

      // Criar diretório do cliente
      await fs.mkdir(clienteDir, { recursive: true });
      console.log(`📁 Diretório criado: ${clienteDir}`);

      // 2. Salvar arquivos localmente
      let assinaturaPath = null;
      let documentosPaths = [];
      let totalArquivos = 0;

      if (files.assinaturaDigital) {
        assinaturaPath = await this.salvarArquivoLocal(
          files.assinaturaDigital,
          clienteDir,
          "assinatura"
        );
        totalArquivos++;
      }

      if (files.documentos && files.documentos.length > 0) {
        for (let i = 0; i < files.documentos.length; i++) {
          const docPath = await this.salvarArquivoLocal(
            files.documentos[i],
            clienteDir,
            `documento-${i + 1}`
          );
          documentosPaths.push(docPath);
          totalArquivos++;
        }
      }

      // 3. Preparar dados para Google Sheets
      const dadosParaSheets = {
        ...formData,
        clienteId: clienteId,
        timestamp: new Date().toISOString(),
        assinaturaDigital: files.assinaturaDigital
          ? await this.fileToBase64(files.assinaturaDigital)
          : null,
        documentos: files.documentos
          ? await Promise.all(
              files.documentos.map((file) => this.fileToBase64(file))
            )
          : [],
      };

      // 4. Enviar para Google Sheets via Apps Script
      let googleSheetsRow = null;
      let googleResponse = null;

      try {
        console.log("🌐 Enviando dados para Google Sheets...");
        googleResponse = await this.enviarParaGoogleSheets(dadosParaSheets);
        googleSheetsRow = googleResponse?.sheetRow || "Não especificado";
        console.log(
          `✅ Dados enviados para Google Sheets (linha ${googleSheetsRow})`
        );
      } catch (googleError) {
        console.warn(
          "⚠️  Erro ao enviar para Google Sheets:",
          googleError.message
        );
        // Continue mesmo com erro no Google Sheets
      }

      // 5. Salvar dados localmente como backup
      const dadosLocal = {
        _id: clienteId,
        ...formData,
        metadata: {
          criadoEm: new Date().toISOString(),
          totalArquivos: totalArquivos,
          googleSheetsRow: googleSheetsRow,
          googleSheetsSuccess: !!googleResponse?.success,
          localPaths: {
            assinatura: assinaturaPath,
            documentos: documentosPaths,
            diretorio: clienteDir,
          },
        },
      };

      await this.salvarDadosLocal(clienteId, dadosLocal);

      // 6. Calcular tempo de processamento
      const processingTime = Date.now() - startTime;
      console.log(`⏱️  Processamento concluído em ${processingTime}ms`);

      return {
        success: true,
        clienteId: clienteId,
        totalArquivos: totalArquivos,
        googleSheetsRow: googleSheetsRow,
        googleResponse: googleResponse,
        localPath: clienteDir,
        processingTime: processingTime,
      };
    } catch (error) {
      console.error("❌ Erro no processamento:", error);
      throw error;
    }
  }

  async salvarArquivoLocal(file, clienteDir, prefixo) {
    try {
      const extensao = path.extname(file.originalname) || ".bin";
      const nomeArquivo = `${prefixo}_${Date.now()}${extensao}`;
      const filePath = path.join(clienteDir, nomeArquivo);

      await fs.writeFile(filePath, file.buffer);
      console.log(`💾 Arquivo salvo localmente: ${nomeArquivo}`);

      return path.relative(this.uploadsDir, filePath);
    } catch (error) {
      console.error(`❌ Erro ao salvar arquivo ${prefixo}:`, error);
      return null;
    }
  }

  async fileToBase64(file) {
    return {
      base64: file.buffer.toString("base64"),
      mimetype: file.mimetype,
      originalname: file.originalname,
    };
  }

  async enviarParaGoogleSheets(dados) {
    try {
      if (!this.webAppUrl) {
        throw new Error("URL do Google Web App não configurada");
      }

      // Preparar payload para Google Sheets
      const payload = {
        ...dados,
        // Garantir que as terapias sejam um array
        terapias: Array.isArray(dados.terapias)
          ? dados.terapias
          : typeof dados.terapias === "string"
          ? dados.terapias.split(",").map((t) => t.trim())
          : [],
        timestamp: new Date().toISOString(),
      };

      console.log("📤 Enviando para Google Sheets...");
      console.log("URL:", this.webAppUrl);

      const response = await axios.post(this.webAppUrl, payload, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 segundos timeout
      });

      if (response.data.success) {
        console.log("✅ Google Sheets respondeu com sucesso");
        return response.data;
      } else {
        throw new Error(
          `Google Sheets error: ${response.data.error || "Unknown error"}`
        );
      }
    } catch (error) {
      console.error("❌ Erro ao enviar para Google Sheets:", error.message);

      // Log mais detalhes se disponível
      if (error.response) {
        console.error("📊 Response data:", error.response.data);
        console.error("📊 Response status:", error.response.status);
      }

      throw new Error(`Falha ao enviar para Google Sheets: ${error.message}`);
    }
  }

  async salvarDadosLocal(clienteId, dados) {
    try {
      const filePath = path.join(this.clientsDir, clienteId, "dados.json");
      await fs.writeFile(filePath, JSON.stringify(dados, null, 2));
      console.log(`💾 Dados salvos localmente: ${filePath}`);
    } catch (error) {
      console.error("❌ Erro ao salvar dados localmente:", error);
    }
  }

  // Métodos para listar clientes (simulando banco de dados)
  async getAllClients() {
    try {
      const clientes = [];

      // Listar todas as pastas de clientes
      const diretorios = await fs.readdir(this.clientsDir, {
        withFileTypes: true,
      });

      for (const diretorio of diretorios) {
        if (diretorio.isDirectory()) {
          const clientePath = path.join(
            this.clientsDir,
            diretorio.name,
            "dados.json"
          );

          try {
            const dados = await fs.readFile(clientePath, "utf8");
            clientes.push(JSON.parse(dados));
          } catch (error) {
            console.warn(
              `⚠️  Não foi possível ler dados do cliente ${diretorio.name}:`,
              error.message
            );
          }
        }
      }

      return clientes;
    } catch (error) {
      console.error("❌ Erro ao listar clientes:", error);
      return [];
    }
  }

  async getClientById(id) {
    try {
      const clientePath = path.join(this.clientsDir, id, "dados.json");
      const dados = await fs.readFile(clientePath, "utf8");
      return JSON.parse(dados);
    } catch (error) {
      console.error(`❌ Erro ao buscar cliente ${id}:`, error);
      return null;
    }
  }

  async updateStatus(clienteId, novoStatus) {
    try {
      const clientePath = path.join(this.clientsDir, clienteId, "dados.json");

      if (!(await this.fileExists(clientePath))) {
        return null;
      }

      const dados = JSON.parse(await fs.readFile(clientePath, "utf8"));
      dados.status = novoStatus;
      dados.metadata.atualizadoEm = new Date().toISOString();

      await fs.writeFile(clientePath, JSON.stringify(dados, null, 2));

      // TODO: Atualizar também no Google Sheets
      console.log(
        `📝 Status atualizado no local, cliente ${clienteId} -> ${novoStatus}`
      );

      return dados;
    } catch (error) {
      console.error(
        `❌ Erro ao atualizar status do cliente ${clienteId}:`,
        error
      );
      throw error;
    }
  }

  async getSystemStats() {
    try {
      const clientes = await this.getAllClients();

      const stats = {
        totalClientes: clientes.length,
        porStatus: {},
        ultimaAtualizacao: new Date().toISOString(),
        armazenamentoLocal: await this.calcularTamanhoDiretorio(
          this.clientsDir
        ),
      };

      // Contar por status
      clientes.forEach((cliente) => {
        const status = cliente.status || "PENDENTE";
        stats.porStatus[status] = (stats.porStatus[status] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error("❌ Erro ao calcular estatísticas:", error);
      return {
        totalClientes: 0,
        porStatus: {},
        erro: error.message,
      };
    }
  }

  async calcularTamanhoDiretorio(dir) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(dir, file.name);

        if (file.isDirectory()) {
          totalSize += await this.calcularTamanhoDiretorio(filePath);
        } else if (file.isFile()) {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }

      return {
        bytes: totalSize,
        megabytes: (totalSize / (1024 * 1024)).toFixed(2),
      };
    } catch (error) {
      return { bytes: 0, megabytes: "0.00" };
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new ClientRegistrationService();
