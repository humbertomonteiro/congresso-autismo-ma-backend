// src/jobs/cleanup.js
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const cleanupBoletos = () => {
  cron.schedule("0 0 * * *", () => {
    // Executa a cada minuto para teste
    console.log("[Cleanup] Limpando arquivos temporários de boletos...");
    const boletoDir = path.join(__dirname, "../temp");
    fs.readdir(boletoDir, (err, files) => {
      if (err) {
        console.error("[Cleanup] Erro ao ler pasta de boletos:", err);
        return;
      }
      files.forEach((file) => {
        const filePath = path.join(boletoDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error("[Cleanup] Erro ao obter stats do arquivo:", err);
            return;
          }
          const now = new Date().getTime();
          const fileAge = (now - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
          if (fileAge > 3) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error("[Cleanup] Erro ao excluir arquivo:", err);
              } else {
                console.log(`[Cleanup] Arquivo ${file} excluído com sucesso.`);
              }
            });
          }
        });
      });
    });
  });
};

module.exports = { cleanupBoletos };
