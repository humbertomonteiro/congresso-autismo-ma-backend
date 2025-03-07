// src/config.js
const { initializeApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");
const dotenv = require("dotenv");

dotenv.config();

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

// Verificação de ambiente (Sandbox ou Produção)
const isProduction = process.env.NODE_ENV === "production";

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

// Configuração do Banco do Brasil (já está OK, mas mantido para referência)
const bancoDoBrasilConfig = {
  clientId: process.env.BB_CLIENT_ID,
  clientSecret: process.env.BB_CLIENT_SECRET,
  developerApiKey: process.env.BB_DEVELOPER_API_KEY,
  baseUrlSandbox: "https://api.sandbox.bb.com.br",
  baseUrlProduction: "https://api.bb.com.br",
  baseUrl: isProduction
    ? "https://api.bb.com.br"
    : "https://api.sandbox.bb.com.br",
  // Certificado comentado por enquanto
  // certificadoPfx: process.env.BB_CERTIFICADO_PFX,
  // certificadoSenha: process.env.BB_CERTIFICADO_SENHA,
};

module.exports = {
  db,
  cieloConfig,
  bancoDoBrasilConfig,
};
