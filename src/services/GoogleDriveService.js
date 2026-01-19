const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const mime = require("mime-types");

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    this.initialize();
  }

  initialize() {
    try {
      // Usando service account
      const credentials = require("../config/google-credentials.json");
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      });

      this.drive = google.drive({ version: "v3", auth });
      console.log("✅ Google Drive Service inicializado");
    } catch (error) {
      console.error("❌ Erro ao inicializar Google Drive:", error.message);
      console.log("⚠️  Verifique se config/google-credentials.json existe");
    }
  }

  async uploadFile(fileBuffer, fileName, mimeType, parentFolderId = null) {
    try {
      if (!this.drive) {
        throw new Error("Google Drive não inicializado");
      }

      const folderId = parentFolderId || this.folderId;
      if (!folderId) {
        throw new Error("ID da pasta do Google Drive não configurado");
      }

      console.log(`   📤 Enviando "${fileName}" para Google Drive...`);

      const fileMetadata = {
        name: fileName,
        parents: [folderId],
      };

      const media = {
        mimeType: mimeType,
        body: fileBuffer,
      };

      const response = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id, name, webViewLink, webContentLink",
      });

      console.log(`   ✅ Arquivo enviado: ${response.data.name}`);
      console.log(`   🔗 ID: ${response.data.id}`);

      // Tornar o arquivo publicamente acessível
      await this.makeFilePublic(response.data.id);

      return {
        success: true,
        fileId: response.data.id,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink,
        directLink: `https://drive.google.com/uc?export=view&id=${response.data.id}`,
        downloadLink: `https://drive.google.com/uc?export=download&id=${response.data.id}`,
      };
    } catch (error) {
      console.error(
        `   ❌ Erro ao enviar arquivo para Drive: ${error.message}`
      );
      return {
        success: false,
        error: error.message,
        fileName: fileName,
      };
    }
  }

  async makeFilePublic(fileId) {
    try {
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
      console.log(`   🔓 Arquivo ${fileId} tornado público`);
      return true;
    } catch (error) {
      console.warn(
        `   ⚠️  Não foi possível tornar arquivo público: ${error.message}`
      );
      return false;
    }
  }

  async uploadMultipleFiles(files, clienteId) {
    const results = {
      assinatura: null,
      documentos: [],
      errors: [],
    };

    // Criar pasta para o cliente no Drive
    const clienteFolder = await this.createFolder(
      `Cliente-${clienteId}`,
      this.folderId
    );

    if (clienteFolder.success) {
      console.log(`   📁 Pasta criada no Drive: Cliente-${clienteId}`);

      // Upload da assinatura
      if (files.assinaturaDigital?.buffer) {
        const assinaturaName = `assinatura_${clienteId}_${Date.now()}.png`;
        const uploadResult = await this.uploadFile(
          files.assinaturaDigital.buffer,
          assinaturaName,
          files.assinaturaDigital.mimetype,
          clienteFolder.folderId
        );

        if (uploadResult.success) {
          results.assinatura = uploadResult;
        } else {
          results.errors.push(`Assinatura: ${uploadResult.error}`);
        }
      }

      // Upload dos documentos
      if (files.documentos?.length > 0) {
        for (const [index, doc] of files.documentos.entries()) {
          if (!doc.buffer) continue;

          const ext = path.extname(doc.originalname) || ".pdf";
          const docName = `documento_${clienteId}_${
            index + 1
          }_${Date.now()}${ext}`;

          const uploadResult = await this.uploadFile(
            doc.buffer,
            docName,
            doc.mimetype,
            clienteFolder.folderId
          );

          if (uploadResult.success) {
            results.documentos.push(uploadResult);
          } else {
            results.errors.push(
              `Documento ${index + 1}: ${uploadResult.error}`
            );
          }
        }
      }
    } else {
      results.errors.push(
        `Falha ao criar pasta do cliente: ${clienteFolder.error}`
      );
    }

    return results;
  }

  async createFolder(folderName, parentFolderId = null) {
    try {
      const folderMetadata = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentFolderId ? [parentFolderId] : [],
      };

      const response = await this.drive.files.create({
        resource: folderMetadata,
        fields: "id, name, webViewLink",
      });

      return {
        success: true,
        folderId: response.data.id,
        folderName: response.data.name,
        webViewLink: response.data.webViewLink,
      };
    } catch (error) {
      console.error(`   ❌ Erro ao criar pasta: ${error.message}`);
      return {
        success: false,
        error: error.message,
        folderName: folderName,
      };
    }
  }

  async testConnection() {
    console.log("\n🧪 TESTE DE CONEXÃO COM GOOGLE DRIVE");

    if (!this.drive) {
      console.log("❌ Google Drive não inicializado");
      return false;
    }

    try {
      // Tenta listar arquivos para testar conexão
      const response = await this.drive.files.list({
        pageSize: 1,
        fields: "files(id, name)",
      });

      console.log("✅ Conexão com Google Drive bem-sucedida!");
      console.log(`📁 Pasta configurada: ${this.folderId}`);
      return true;
    } catch (error) {
      console.error("❌ Falha na conexão com Google Drive:", error.message);
      return false;
    }
  }
}

module.exports = new GoogleDriveService();
