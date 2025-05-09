const { initializeApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");
const dotenv = require("dotenv");

// Carrega variáveis de ambiente
dotenv.config();

// Configuração do ambiente
const env = process.env.BB_ENV || "sandbox";
const isProduction = env === "production";

console.log("Ambiente (BB_ENV):", env);
console.log("isProduction:", isProduction);

// Configuração do Firebase
const firebaseConfig = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.AUTH_DOMAIN,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
  appId: process.env.APP_ID,
  measurementId: process.env.MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Configuração da Cielo
const cieloConfig = {
  merchantId: isProduction
    ? process.env.CIELO_MERCHANT_ID_PRODUCTION
    : process.env.CIELO_MERCHANT_ID_SANDBOX,
  merchantKey: isProduction
    ? process.env.CIELO_MERCHANT_KEY_PRODUCTION
    : process.env.CIELO_MERCHANT_KEY_SANDBOX,
  baseUrl: isProduction
    ? "https://api.cieloecommerce.cielo.com.br"
    : "https://apisandbox.cieloecommerce.cielo.com.br",
  baseQueryUrl: isProduction
    ? "https://apiquery.cieloecommerce.cielo.com.br"
    : "https://apiquerysandbox.cieloecommerce.cielo.com.br",
};

// Configuração do Banco do Brasil
const bancoDoBrasilConfig = {
  clientId: isProduction
    ? process.env.BB_CLIENT_ID_PRODUCTION
    : process.env.BB_CLIENT_ID_SANDBOX,
  clientSecret: isProduction
    ? process.env.BB_CLIENT_SECRET_PRODUCTION
    : process.env.BB_CLIENT_SECRET_SANDBOX,
  developerApiKey: isProduction
    ? process.env.BB_DEVELOPER_API_KEY_PRODUCTION
    : process.env.BB_DEVELOPER_API_KEY_SANDBOX,
  numeroConvenio: isProduction
    ? process.env.BB_NUMERO_CONVENIO_PRODUCTION
    : process.env.BB_NUMERO_CONVENIO_SANDBOX || "3128557",
  agencia: isProduction
    ? process.env.BB_AGENCIA_PRODUCTION
    : process.env.BB_AGENCIA_SANDBOX || "6543-1",
  conta: isProduction
    ? process.env.BB_CONTA_PRODUCTION
    : process.env.BB_CONTA_SANDBOX || "123456-7",
  numeroCarteira: isProduction
    ? process.env.BB_NUMERO_CARTEIRA_PRODUCTION || 17
    : process.env.BB_NUMERO_CARTEIRA_SANDBOX || 17,
  cnpj: isProduction
    ? process.env.BB_CNPJ_PRODUCTION
    : process.env.BB_CNPJ_SANDBOX,
  numeroVariacaoCarteira: isProduction
    ? process.env.BB_NUMERO_VARIACAO_CARTEIRA_PRODUCTION || 35
    : process.env.BB_NUMERO_VARIACAO_CARTEIRA_SANDBOX || 35,
  baseUrl: isProduction
    ? "https://api.bb.com.br/cobrancas/v2"
    : "https://api.hm.bb.com.br/cobrancas/v2",
  authBaseUrl: isProduction
    ? "https://oauth.bb.com.br"
    : "https://oauth.sandbox.bb.com.br",
  certificadoPfx: process.env.BB_CERTIFICADO_PFX,
  certificadoSenha: process.env.BB_CERTIFICADO_SENHA,
};

// Log para depuração (pode remover em produção)
console.log("Cielo Config:", {
  merchantId: cieloConfig.merchantId,
  merchantKey: cieloConfig.merchantKey,
});

// Exportação das configurações
module.exports = {
  port: process.env.PORT || 5000, // Adicionado para o index.js
  env: {
    name: env,
    isProduction,
  },
  firebase: {
    db,
  },
  cielo: cieloConfig,
  bancoDoBrasil: bancoDoBrasilConfig,
};
