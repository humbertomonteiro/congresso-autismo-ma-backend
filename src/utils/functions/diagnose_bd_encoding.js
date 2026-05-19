/**
 * Analisa os code points de todos os nomes de participantes da Bilheteria
 * Digital para identificar exatamente qual padrão de encoding está quebrado.
 *
 * Saída:
 *   - Lista de nomes com caracteres não-ASCII
 *   - Code points de cada caractere suspeito
 *   - Tentativa de reversão via Latin-1, Windows-1252 e outras estratégias
 *   - Arquivo JSON: bd_encoding_report_<timestamp>.json
 *
 * Uso:
 *   node src/utils/functions/diagnose_bd_encoding.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

// ── Estratégias de reversão ────────────────────────────────────────────────

// Windows-1252: code point → byte (apenas os especiais 0x80-0x9F)
const WIN1252_TO_BYTE = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Tenta reverter UTF-8-lido-como-Windows-1252 (mojibake clássico). */
function tryWin1252toUtf8(str) {
  try {
    const bytes = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp > 0xff) {
        if (WIN1252_TO_BYTE[cp] !== undefined) bytes.push(WIN1252_TO_BYTE[cp]);
        else return null;
      } else {
        bytes.push(cp);
      }
    }
    const result = Buffer.from(bytes).toString("utf8");
    return result.includes("�") || result === str ? null : result;
  } catch { return null; }
}

/** Tenta reverter Latin-1 (ISO-8859-1) → UTF-8. */
function tryLatin1toUtf8(str) {
  try {
    const bytes = str.split("").map(c => c.charCodeAt(0) & 0xff);
    const result = Buffer.from(bytes).toString("utf8");
    return result.includes("�") || result === str ? null : result;
  } catch { return null; }
}

/** Tenta interpretar a string como UTF-8 bytes armazenados em pares (double encode). */
function tryDoubleEncode(str) {
  try {
    const bytes = Buffer.from(str, "utf8");
    const result = Buffer.from(bytes.toString("latin1"), "utf8").toString("utf8");
    return result.includes("�") || result === str ? null : result;
  } catch { return null; }
}

// ──────────────────────────────────────────────────────────────────────────

/** Retorna os code points de uma string em formato legível. */
function codePoints(str) {
  return [...str].map(ch => {
    const cp = ch.codePointAt(0);
    return `${JSON.stringify(ch)}=U+${cp.toString(16).toUpperCase().padStart(4,"0")}(${cp})`;
  }).join("  ");
}

/** Verifica se uma string tem algum caractere não-ASCII. */
function hasNonAscii(str) {
  return str && [...str].some(ch => ch.codePointAt(0) > 0x7f);
}

const run = async () => {
  console.log("Buscando checkouts da Bilheteria Digital...");
  const checkouts = await CheckoutRepository.fetchCheckouts({ paymentMethod: "bilheteria-digital" });
  console.log(`  ${checkouts.length} checkout(s)\n`);

  const report = [];

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      if (!hasNonAscii(p.name)) continue;

      const w = tryWin1252toUtf8(p.name);
      const l = tryLatin1toUtf8(p.name);
      const d = tryDoubleEncode(p.name);

      const entry = {
        checkoutId: checkout.id,
        participantId: p.id,
        name: p.name,
        codePoints: codePoints(p.name),
        win1252fix: w || "(sem resultado)",
        latin1fix:  l || "(sem resultado)",
        doubleFix:  d || "(sem resultado)",
      };
      report.push(entry);

      console.log(`── ${checkout.id} / ${p.id}`);
      console.log(`   Nome     : ${p.name}`);
      console.log(`   CodePts  : ${codePoints(p.name)}`);
      console.log(`   Win1252→UTF8 : ${w || "✗"}`);
      console.log(`   Latin1→UTF8  : ${l || "✗"}`);
      console.log(`   DoubleEnc    : ${d || "✗"}`);
      console.log();
    }
  }

  const ts = Date.now();
  const file = path.join(__dirname, `bd_encoding_report_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

  console.log(`─── Resumo ──────────────────────────────`);
  console.log(`Nomes com não-ASCII    : ${report.length}`);
  const fixable = report.filter(e => e.win1252fix !== "(sem resultado)").length;
  console.log(`Corrigíveis (Win1252)  : ${fixable}`);
  console.log(`Relatório salvo em     : ${file}`);
};

run().catch(err => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
