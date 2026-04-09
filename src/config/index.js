const admin = require("firebase-admin");
const dotenv = require("dotenv");

dotenv.config();

const env = process.env.BB_ENV || "sandbox";
const isProduction = env === "production";

console.log("Ambiente (BB_ENV):", env);
console.log("isProduction:", isProduction);

// Firebase Admin SDK — usa a Service Account via variável de ambiente
// No .env: FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...} (conteúdo do JSON em uma linha)
const path = require("path");
const serviceAccount = require(path.resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH
));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

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
  pixKey: isProduction
    ? process.env.BB_PIX_KEY_PRODUCTION
    : process.env.BB_PIX_KEY_SANDBOX,
  numeroVariacaoCarteira: isProduction
    ? process.env.BB_NUMERO_VARIACAO_CARTEIRA_PRODUCTION || 35
    : process.env.BB_NUMERO_VARIACAO_CARTEIRA_SANDBOX || 35,
  baseUrl: isProduction
    ? "https://api.bb.com.br/cobrancas/v2"
    : "https://api.hm.bb.com.br/cobrancas/v2",
  authBaseUrl: isProduction
    ? "https://oauth.bb.com.br"
    : "https://oauth.sandbox.bb.com.br",
};

const eventConfig = {
  name: "Congresso Autismo MA 2026",
  dates: ["2026-05-16", "2026-05-17"],
  // Para novos eventos, atualize apenas aqui
};

const valueTickets = {
  allTicket: 674,
  halfTicket: 337,
  socialTicket: 347,
};

module.exports = {
  port: process.env.PORT || 5000,
  env: { name: env, isProduction },
  firebase: { db, admin },
  cielo: cieloConfig,
  bancoDoBrasil: bancoDoBrasilConfig,
  event: eventConfig,
  valueTickets,
};
