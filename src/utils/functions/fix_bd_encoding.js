/**
 * Corrige nomes com problemas de encoding nos participantes importados da
 * Bilheteria Digital.
 *
 * Problema: o xlsx foi exportado em UTF-8, mas o processo de leitura tratou
 * cada byte do UTF-8 como um caractere Latin-1/Windows-1252 individual,
 * gerando "mojibake" — ex.: "ARAÃšJO" em vez de "ARAÚJO".
 *
 * Solução: reverter cada caractere para seu valor de byte Windows-1252 e
 * decodificar o buffer resultante como UTF-8.
 *
 * Uso:
 *   node src/utils/functions/fix_bd_encoding.js
 *       → mostra o que seria corrigido (dry run)
 *
 *   node src/utils/functions/fix_bd_encoding.js --debug
 *       → mostra code points dos caracteres (ajuda a diagnosticar casos novos)
 *
 *   node src/utils/functions/fix_bd_encoding.js --fix
 *       → aplica as correções no Firestore
 */

require("dotenv").config();
const CheckoutRepository = require("../../repositories/CheckoutRepository");
const { firebase } = require("../../config");
const { db, admin } = firebase;

const FIX = process.argv.includes("--fix");
const DEBUG = process.argv.includes("--debug");

// Mapa: code point Unicode → byte Windows-1252
// Cobre os caracteres especiais do intervalo 0x80–0x9F do Windows-1252 que
// diferem do Latin-1 (fora desse intervalo, code point == byte value).
const WIN1252_TO_BYTE = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/**
 * Reverte mojibake (UTF-8 lido como Windows-1252) para a string correta.
 * Retorna null se não há correção a fazer ou se não for possível corrigir.
 */
function fixMojibake(str) {
  if (!str || typeof str !== "string") return null;

  try {
    const bytes = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);

      if (cp > 0xff) {
        // Acima de 0xFF só chegam os Windows-1252 especiais (ex.: š = U+0161)
        if (WIN1252_TO_BYTE[cp] !== undefined) {
          bytes.push(WIN1252_TO_BYTE[cp]);
        } else {
          // Caractere genuinamente fora do espaço Windows-1252 → não é mojibake
          return null;
        }
      } else {
        // 0x00–0xFF: usa o code point diretamente como byte value.
        // Isso cobre:
        //   - 0x00–0x7F  ASCII
        //   - 0x80–0x9F  bytes indefinidos no Windows-1252 (passados como C1)
        //   - 0xA0–0xFF  Latin-1 estendido (code point == byte value)
        bytes.push(cp);
      }
    }

    const fixed = Buffer.from(bytes).toString("utf8");

    // Se havia bytes inválidos em UTF-8 → não é o padrão de mojibake
    if (fixed.includes("�")) return null;

    // Sem diferença → nome já estava correto
    if (fixed === str) return null;

    return fixed;
  } catch {
    return null;
  }
}

/** Exibe os code points de uma string para diagnóstico. */
function debugCodePoints(str) {
  return [...str]
    .map((ch) => `${ch}(U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`)
    .join(" ");
}

const run = async () => {
  console.log(`Modo: ${FIX ? "CORRIGIR no Firestore" : DEBUG ? "debug (code points)" : "dry run"}\n`);

  console.log("Buscando checkouts da Bilheteria Digital...");
  const checkouts = await CheckoutRepository.fetchCheckouts({
    paymentMethod: "bilheteria-digital",
  });
  console.log(`  ${checkouts.length} checkout(s) encontrado(s)\n`);

  let totalParticipants = 0;
  let toFix = 0;
  let fixed = 0;
  let errors = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      totalParticipants++;
      const corrected = fixMojibake(p.name);

      if (DEBUG && p.name) {
        const hasNonAscii = [...p.name].some((ch) => ch.codePointAt(0) > 0x7f);
        if (hasNonAscii) {
          console.log(`  ${checkout.id} / ${p.id} | ${p.name}`);
          console.log(`    → ${debugCodePoints(p.name)}`);
          if (corrected) console.log(`    ✓ seria: ${corrected}`);
          else console.log(`    – sem correção automática`);
        }
        continue;
      }

      if (!corrected) continue;

      toFix++;
      console.log(`  ${checkout.id} / ${p.id}`);
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
          fixed++;
        } catch (err) {
          console.error(`    ✗ Erro: ${err.message}`);
          errors++;
        }
      }
    }

    // Corrige também o buyerName no documento do checkout
    if (!DEBUG) {
      const buyerFixed = fixMojibake(checkout.buyerName);
      if (buyerFixed) {
        toFix++;
        console.log(`  [checkout] ${checkout.id}`);
        console.log(`    Antes : ${checkout.buyerName}`);
        console.log(`    Depois: ${buyerFixed}`);

        if (FIX) {
          try {
            await db
              .collection("checkouts")
              .doc(checkout.id)
              .update({
                buyerName: buyerFixed,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
          } catch (err) {
            console.error(`    ✗ Erro ao atualizar buyerName: ${err.message}`);
          }
        }
      }
    }
  }

  if (!DEBUG) {
    console.log(`\n─── Resultado ───────────────────────────`);
    console.log(`Participantes verificados : ${totalParticipants}`);
    console.log(`Com encoding errado       : ${toFix}`);
    if (FIX) {
      console.log(`Corrigidos                : ${fixed}`);
      console.log(`Erros                     : ${errors}`);
    } else if (toFix > 0) {
      console.log(`\nRodando com --fix esses ${toFix} nome(s) serão corrigidos.`);
    } else {
      console.log(`\nNenhum problema de encoding encontrado.`);
    }
  }
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
