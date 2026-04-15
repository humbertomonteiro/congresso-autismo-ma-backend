const { join } = require("path");

/**
 * Força o puppeteer a instalar o Chrome dentro do diretório do projeto.
 * Isso garante que o binário persista entre o build e o runtime no Render.com.
 */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
