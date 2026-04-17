/**
 * testPixProduction.js
 *
 * Debug do fluxo PIX em produção — loga URLs, tokens e respostas completas.
 *
 * Uso:
 *   node testPixProduction.js
 *
 * ATENÇÃO: Usa as credenciais de PRODUÇÃO. Vai criar uma cobrança real de R$ 0,01.
 */

require("dotenv").config();
const axios = require("axios");
const https = require("https");

// Força produção independente do .env
const CLIENT_ID     = process.env.BB_CLIENT_ID_PRODUCTION;
const CLIENT_SECRET = process.env.BB_CLIENT_SECRET_PRODUCTION;
const API_KEY       = process.env.BB_DEVELOPER_API_KEY_PRODUCTION;
const PIX_KEY       = process.env.BB_PIX_KEY_PRODUCTION;
const AUTH_URL      = "https://oauth.bb.com.br";
const PIX_BASE_URL  = "https://api.bb.com.br/pix/v2";

const agent = new https.Agent({ rejectUnauthorized: false });

function line(c = "─", n = 70) { return c.repeat(n); }
function ok(label, val)   { console.log(`  ✅  ${label}:`, val ?? "(vazio)"); }
function fail(label, val) { console.log(`  ❌  ${label}:`, val ?? "(sem detalhe)"); }

// ── 1. Verifica variáveis ────────────────────────────────────────────────────
function checkEnv() {
  console.log(`\n${line()}`);
  console.log("  PASSO 0 — Variáveis de ambiente (produção)");
  console.log(line());

  const vars = { CLIENT_ID, CLIENT_SECRET, API_KEY, PIX_KEY };
  let allOk = true;
  for (const [k, v] of Object.entries(vars)) {
    if (!v) { fail(k, "NÃO DEFINIDO"); allOk = false; }
    else     { ok(k, k.includes("SECRET") ? "***" : v); }
  }
  ok("AUTH_URL",     AUTH_URL);
  ok("PIX_BASE_URL", PIX_BASE_URL);

  if (!allOk) throw new Error("Corrija as variáveis e tente novamente.");
}

// ── 2. Obtém token PIX ───────────────────────────────────────────────────────
async function getToken() {
  console.log(`\n${line()}`);
  console.log("  PASSO 1 — OAuth2 token (scope: cob.write cob.read)");
  console.log(line());

  const tokenUrl = `${AUTH_URL}/oauth/token`;
  console.log(`  URL: POST ${tokenUrl}`);

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  try {
    const res = await axios.post(
      tokenUrl,
      new URLSearchParams({ grant_type: "client_credentials", scope: "cob.write cob.read" }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: agent,
        timeout: 15000,
      }
    );
    ok("Token", res.data.access_token.slice(0, 50) + "...");
    ok("Tipo",  res.data.token_type);
    ok("Expira em", `${res.data.expires_in}s`);
    ok("Scopes", res.data.scope);
    return res.data.access_token;
  } catch (err) {
    fail("Falha na autenticação", err.message);
    if (err.response) {
      fail("HTTP status", err.response.status);
      fail("Resposta BB", JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
}

// ── 3. Cria cobrança PIX ─────────────────────────────────────────────────────
async function criarCobranca(token) {
  console.log(`\n${line()}`);
  console.log("  PASSO 2 — POST /cob (R$ 0,01 de teste)");
  console.log(line());

  const url = `${PIX_BASE_URL}/cob?gw-dev-app-key=${API_KEY}`;
  console.log(`  URL: POST ${url}`);

  const payload = {
    calendario: { expiracao: 3600 },
    devedor: { cpf: "12345678909", nome: "Teste Debug Producao" },
    valor: { original: "0.01" },
    chave: PIX_KEY,
    solicitacaoPagador: "Teste debug producao",
  };

  console.log("\n  Payload:");
  console.log(JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent,
      timeout: 15000,
    });

    console.log(`\n  HTTP ${res.status}`);
    ok("txid",          res.data.txid);
    ok("status",        res.data.status);
    ok("chave",         res.data.chave);
    ok("location",      res.data.location);
    ok("pixCopiaECola", res.data.pixCopiaECola
      ? res.data.pixCopiaECola.slice(0, 60) + "..."
      : "(não retornado)"
    );

    return res.data;
  } catch (err) {
    fail(`Falha HTTP ${err.response?.status ?? "?"}`, err.message);
    if (err.response) {
      console.log("\n  Resposta completa do BB:");
      console.log(JSON.stringify(err.response.data, null, 2));

      const code = err.response.data?.code || err.response.data?.errorCode;
      if (err.response.status === 404) {
        console.log(`\n  ${line("─")}`);
        console.log("  DIAGNÓSTICO 404:");
        console.log("  A URL foi aceita pelo gateway mas o recurso não existe.");
        console.log("  Possíveis causas:");
        console.log("    1. A chave PIX não está cadastrada na conta de produção");
        console.log("    2. O gw-dev-app-key de produção está errado");
        console.log("    3. A conta não tem o produto PIX Cobrança v2 ativo");
        console.log(`  ${line("─")}`);
      }
      if (err.response.status === 403) {
        console.log("  DIAGNÓSTICO 403: Sem permissão — verifique scopes ou se o app tem PIX habilitado.");
      }
      if (err.response.status === 401) {
        console.log("  DIAGNÓSTICO 401: Token inválido — verifique CLIENT_ID e CLIENT_SECRET de produção.");
      }
    }
    throw err;
  }
}

// ── 4. Testa URLs alternativas para encontrar a correta ──────────────────────
async function descobrirUrl(token) {
  console.log(`\n${line()}`);
  console.log("  PASSO 2b — Testando URLs alternativas (GET, sem criar cobrança)");
  console.log(line());

  const candidatos = [
    `https://api.bb.com.br/pix/v2`,
    `https://api.bb.com.br/pix/v1`,
    `https://api.bb.com.br/cobrancas/v2/pix`,
    `https://api.bb.com.br/pix-cobranca/v2`,
    `https://api.bb.com.br/v2/pix`,
  ];

  for (const base of candidatos) {
    const url = `${base}/cob?gw-dev-app-key=${API_KEY}&inicio=2026-01-01T00:00:00Z&fim=2026-12-31T23:59:59Z`;
    process.stdout.write(`  Testando: GET ${url} ... `);
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        httpsAgent: agent,
        timeout: 8000,
      });
      console.log(`✅  HTTP ${res.status}`);
      return base;
    } catch (err) {
      const status = err.response?.status ?? "timeout/erro";
      const detail = err.response?.data?.detail || err.response?.data?.error || "";
      console.log(`❌  ${status} ${detail}`);
    }
  }

  return null;
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  try {
    checkEnv();
    const token = await getToken();

    const urlCorreta = await descobrirUrl(token);

    if (!urlCorreta) {
      console.log(`\n  ${line("─")}`);
      console.log("  ⚠️  Nenhuma URL funcionou.");
      console.log("  Verifique a URL exata na documentação do portal BB:");
      console.log("  Portal → Aplicação 200042 → Pix (v2) → Documentação → Servidor de produção");
      console.log(`  ${line("─")}`);
      process.exit(1);
    }

    console.log(`\n  ✅  URL correta encontrada: ${urlCorreta}`);
    console.log(`  Atualize no backend/src/config/index.js:`);
    console.log(`  pixBaseUrl (produção): "${urlCorreta}"`);

    await criarCobranca(token);

    console.log(`\n${line("═")}`);
    console.log("  ✅  PIX de produção funcionando!");
    console.log(line("═"));
  } catch (err) {
    console.log(`\n${line("═")}`);
    console.log("  ❌  TESTE FALHOU");
    console.log(`  Erro: ${err.message}`);
    console.log(line("═"));
    process.exit(1);
  }
})();
