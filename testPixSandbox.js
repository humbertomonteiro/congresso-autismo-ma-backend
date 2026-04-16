/**
 * testPixSandbox.js
 *
 * Testa o fluxo completo do PIX no ambiente sandbox do Banco do Brasil.
 * Não salva nada no Firestore — apenas valida a integração com a API.
 *
 * Uso:
 *   node testPixSandbox.js
 *
 * Pré-requisitos:
 *   - BB_ENV=sandbox no .env
 *   - BB_CLIENT_ID_SANDBOX, BB_CLIENT_SECRET_SANDBOX, BB_DEVELOPER_API_KEY_SANDBOX
 *   - BB_PIX_KEY_SANDBOX configurado
 */

require("dotenv").config();
const axios = require("axios");
const https = require("https");
const config = require("./src/config");

const agent = new https.Agent({ rejectUnauthorized: false });

const {
  clientId,
  clientSecret,
  developerApiKey,
  pixKey,
  authBaseUrl,
  pixBaseUrl,
} = config.bancoDoBrasil;

const ENV_LABEL = config.env.isProduction ? "PRODUÇÃO" : "SANDBOX";

// ── Helpers ────────────────────────────────────────────────────────────────────

function line(char = "─", len = 60) {
  return char.repeat(len);
}

function ok(label, value) {
  const display = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
  console.log(`  ✅  ${label}:`, display ?? "(vazio)");
}

function fail(label, value) {
  console.log(`  ❌  ${label}:`, value ?? "(sem detalhe)");
}

function warn(label, value) {
  console.log(`  ⚠️   ${label}:`, value ?? "");
}

// ── Passo 1: verificar variáveis de ambiente ───────────────────────────────────

function checkEnv() {
  console.log(`\n${line()}`);
  console.log(`  Ambiente: ${ENV_LABEL}`);
  console.log(line());

  const required = {
    clientId:       clientId,
    clientSecret:   clientSecret,
    developerApiKey: developerApiKey,
    pixKey:         pixKey,
    authBaseUrl:    authBaseUrl,
    pixBaseUrl:     pixBaseUrl,
  };

  let allOk = true;
  for (const [key, val] of Object.entries(required)) {
    if (!val) {
      fail(`${key}`, "NÃO DEFINIDO — verifique o .env");
      allOk = false;
    } else {
      ok(key, key.toLowerCase().includes("secret") ? "***" : val);
    }
  }

  if (!allOk) {
    throw new Error("Variáveis obrigatórias não configuradas. Corrija o .env e tente novamente.");
  }
}

// ── Passo 2: obter token OAuth com scopes PIX ──────────────────────────────────

async function getPixToken() {
  console.log(`\n${line()}`);
  console.log("  Passo 1 — Autenticação OAuth (scopes: cob.write cob.read)");
  console.log(line());

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const res = await axios.post(
      `${authBaseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "cob.write cob.read",
      }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: agent,
        timeout: 15000,
      }
    );

    const token = res.data.access_token;
    ok("Token obtido", token.slice(0, 40) + "...");
    ok("Tipo",         res.data.token_type);
    ok("Expira em",    `${res.data.expires_in}s`);
    ok("Scopes",       res.data.scope);
    return token;
  } catch (err) {
    const detail = err.response?.data;
    fail("Falha na autenticação", err.message);
    if (detail) fail("Detalhe da API", JSON.stringify(detail));
    throw err;
  }
}

// ── Passo 3: criar cobrança PIX imediata (cob) ────────────────────────────────

async function criarCobranca(token) {
  console.log(`\n${line()}`);
  console.log("  Passo 2 — Criar cobrança PIX (POST /cob)");
  console.log(line());

  const endpoint = `${pixBaseUrl}/cob?gw-dev-app-key=${developerApiKey}`;

  // Dados de teste — CPF válido para sandbox
  const payload = {
    calendario: { expiracao: 3600 },
    devedor: {
      cpf: "12345678909",
      nome: "Cliente Teste Sandbox",
    },
    valor: {
      original: "1.00",
    },
    chave: pixKey,
    solicitacaoPagador: "Teste PIX Sandbox — Congresso Autismo MA 2026",
    infoAdicionais: [{ nome: "Ambiente", valor: "SANDBOX" }],
  };

  console.log("\n  Payload enviado:");
  console.log(JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent,
      timeout: 15000,
    });

    const data = res.data;

    console.log(`\n  Resposta HTTP ${res.status}:`);
    ok("txid",          data.txid);
    ok("status",        data.status);
    ok("chave",         data.chave);
    ok("location",      data.location);
    ok("pixCopiaECola", data.pixCopiaECola
      ? data.pixCopiaECola.slice(0, 60) + "..."
      : "(não retornado)"
    );

    return data;
  } catch (err) {
    const detail = err.response?.data;
    const status = err.response?.status;

    fail(`Falha ao criar cobrança (HTTP ${status ?? "?"})`, err.message);
    if (detail) {
      fail("Detalhe da API", JSON.stringify(detail, null, 2));
    }

    // Diagnóstico específico por código de erro BB
    if (detail?.code === "305") {
      console.log(`
  ${line("─")}
  ℹ️   DIAGNÓSTICO: Chave PIX não encontrada no DICT (código 305)

  A chave "${pixKey}" não está cadastrada para esta conta sandbox.

  Como resolver:
  1. Acesse https://developers.bb.com.br
  2. Vá em "Minhas aplicações" → selecione sua app sandbox
  3. No menu "Ambiente de Testes", veja qual chave PIX está
     disponível para o perfil de teste
  4. Copie a chave correta e atualize no .env:
       BB_PIX_KEY_SANDBOX=<chave-correta>

  Formatos possíveis:
    • CNPJ:           02518688000121
    • CPF:            12345678909
    • E-mail:         qualquer@email.com
    • Telefone:       +5561900000000
    • Chave aleatória: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

  ⚠️  ATENÇÃO: A autenticação OAuth funcionou com sucesso — os
  scopes "cob.write cob.read" foram aceitos. Só falta a chave PIX.
  ${line("─")}`);
    } else if (status === 401) {
      console.log(`
  ${line("─")}
  ℹ️   DIAGNÓSTICO: Token inválido / credenciais incorretas (401)
  Verifique BB_CLIENT_ID_SANDBOX e BB_CLIENT_SECRET_SANDBOX no .env.
  ${line("─")}`);
    } else if (status === 403) {
      console.log(`
  ${line("─")}
  ℹ️   DIAGNÓSTICO: Sem permissão (403)
  Verifique se a aplicação no portal BB tem o produto PIX habilitado.
  ${line("─")}`);
    }

    throw err;
  }
}

// ── Passo 4: consultar status da cobrança ─────────────────────────────────────

async function consultarCobranca(token, txid) {
  console.log(`\n${line()}`);
  console.log(`  Passo 3 — Consultar status (GET /cob/${txid})`);
  console.log(line());

  const endpoint = `${pixBaseUrl}/cob/${txid}?gw-dev-app-key=${developerApiKey}`;

  try {
    const res = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent,
      timeout: 15000,
    });

    ok("status", res.data.status);
    ok("valor",  res.data.valor?.original);
    ok("chave",  res.data.chave);
    return res.data;
  } catch (err) {
    const detail = err.response?.data;
    fail(`Falha ao consultar (HTTP ${err.response?.status ?? "?"})`, err.message);
    if (detail) fail("Detalhe", JSON.stringify(detail));
    throw err;
  }
}

// ── Resumo final ───────────────────────────────────────────────────────────────

function resumo(cobranca) {
  console.log(`\n${line("═")}`);
  console.log("  RESULTADO DO TESTE");
  console.log(line("═"));
  console.log(`  Ambiente:      ${ENV_LABEL}`);
  console.log(`  txid:          ${cobranca.txid}`);
  console.log(`  Status BB:     ${cobranca.status}`);
  console.log(`  Chave PIX:     ${cobranca.chave}`);
  console.log(`  Valor:         R$ ${cobranca.valor?.original}`);

  if (cobranca.pixCopiaECola) {
    console.log(`\n  Código copia-e-cola (PIX string completa):`);
    console.log(`  ${cobranca.pixCopiaECola}`);
  } else {
    warn("pixCopiaECola não retornado", "No sandbox isso pode ser normal — verifique location.");
  }

  if (cobranca.location) {
    console.log(`\n  URL do QR Code (location):`);
    console.log(`  ${cobranca.location}`);
  }

  console.log(`\n${line("═")}`);
  console.log("  ✅  Integração PIX funcionando corretamente no sandbox.");
  console.log(line("═"));
}

// ── Entry point ────────────────────────────────────────────────────────────────

(async () => {
  try {
    checkEnv();
    const token = await getPixToken();
    const cobranca = await criarCobranca(token);
    await consultarCobranca(token, cobranca.txid);
    resumo(cobranca);
  } catch (err) {
    console.log(`\n${line("═")}`);
    console.log("  ❌  TESTE FALHOU");
    console.log(line("═"));
    console.log(`  Erro: ${err.message}`);
    console.log(line("═"));
    process.exit(1);
  }
})();
