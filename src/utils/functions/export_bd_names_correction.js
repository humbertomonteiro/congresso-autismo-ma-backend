/**
 * Exporta nomes com encoding corrompido dos participantes da Bilheteria Digital.
 *
 * Para cada participante com caracteres não-ASCII:
 *   - Tenta correção automática (Win1252 mojibake fix)
 *   - Se corrigível: exibe antes/depois e aplica no Firestore (com --fix)
 *   - Se não corrigível: inclui no CSV para correção manual no dashboard
 *
 * Saída:
 *   - bd_names_correction_<timestamp>.csv — lista para correção manual
 *
 * Uso:
 *   node src/utils/functions/export_bd_names_correction.js
 *       → dry run: mostra correções automáticas + gera CSV de pendências
 *
 *   node src/utils/functions/export_bd_names_correction.js --fix
 *       → aplica correções automáticas no Firestore + gera CSV de pendências
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");
const { firebase } = require("../../config");
const { db, admin } = firebase;

const FIX = process.argv.includes("--fix");

const WIN1252_TO_BYTE = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function fixMojibake(str) {
  if (!str || typeof str !== "string") return null;
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
    const fixed = Buffer.from(bytes).toString("utf8");
    if (fixed.includes("�")) return null;
    if (fixed === str) return null;
    return fixed;
  } catch { return null; }
}

function hasNonAscii(str) {
  return str && [...str].some(ch => ch.codePointAt(0) > 0x7f);
}

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const run = async () => {
  console.log(`Modo: ${FIX ? "CORRIGIR no Firestore" : "dry run"}\n`);

  console.log("Buscando checkouts da Bilheteria Digital...");
  const checkouts = await CheckoutRepository.fetchCheckouts({ paymentMethod: "bilheteria-digital" });
  console.log(`  ${checkouts.length} checkout(s)\n`);

  const csvRows = [];
  let autoFixed = 0;
  let pendingManual = 0;
  let errors = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      if (!hasNonAscii(p.name)) continue;

      const corrected = fixMojibake(p.name);

      if (corrected) {
        console.log(`  [AUTO] ${checkout.id} / ${p.id}`);
        console.log(`    Antes : ${p.name}`);
        console.log(`    Depois: ${corrected}`);

        if (FIX) {
          try {
            await db
              .collection("checkouts")
              .doc(checkout.id)
              .collection("participants")
              .doc(p.id)
              .update({
                name: corrected,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            autoFixed++;
          } catch (err) {
            console.error(`    ✗ Erro: ${err.message}`);
            errors++;
          }
        } else {
          autoFixed++;
        }
      } else {
        pendingManual++;
        csvRows.push({
          checkoutId: checkout.id,
          participantId: p.id,
          nome_atual: p.name,
          sugestao: "",
        });
      }
    }

    // Verifica buyerName do checkout também
    if (hasNonAscii(checkout.buyerName)) {
      const buyerFixed = fixMojibake(checkout.buyerName);
      if (buyerFixed) {
        console.log(`  [AUTO-buyer] ${checkout.id}`);
        console.log(`    Antes : ${checkout.buyerName}`);
        console.log(`    Depois: ${buyerFixed}`);
        if (FIX) {
          try {
            await db.collection("checkouts").doc(checkout.id).update({
              buyerName: buyerFixed,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (err) {
            console.error(`    ✗ Erro buyerName: ${err.message}`);
          }
        }
      } else {
        csvRows.push({
          checkoutId: checkout.id,
          participantId: "(buyerName)",
          nome_atual: checkout.buyerName,
          sugestao: "",
        });
      }
    }
  }

  const ts = Date.now();
  const csvFile = path.join(__dirname, `bd_names_correction_${ts}.csv`);
  const header = "checkoutId,participantId,nome_atual,sugestao\n";
  const body = csvRows
    .map(r => [r.checkoutId, r.participantId, r.nome_atual, r.sugestao].map(escapeCsv).join(","))
    .join("\n");
  // BOM (0xEF 0xBB 0xBF) para o Excel abrir em UTF-8 corretamente
  fs.writeFileSync(csvFile, "﻿" + header + body, "utf8");

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Correções automáticas  : ${autoFixed}${FIX ? " (aplicadas)" : " (dry run — use --fix para aplicar)"}`);
  console.log(`Pendentes (manual)     : ${pendingManual}`);
  if (errors) console.log(`Erros                  : ${errors}`);
  console.log(`CSV salvo em           : ${csvFile}`);
};

run().catch(err => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
