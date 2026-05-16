/**
 * Corrige participantes de checkouts com paymentMethod "bilheteria-digital":
 *   1. Normaliza o campo "document" para apenas dígitos (remove pontos e traço)
 *   2. Gera qrToken para quem ainda não tem (necessário para emitir ingresso/certificado)
 *
 * Não reescreve o checkout nem os dados editados manualmente — só ajusta os
 * campos acima em cada participante.
 *
 * Uso:
 *   node src/utils/functions/fix_bilheteria_digital.js
 */

const CheckoutRepository = require("../../repositories/CheckoutRepository");
const CredentialService = require("../../services/CredentialService");
const { firebase } = require("../../config");

const { db } = firebase;

const run = async () => {
  console.log("Buscando checkouts da Bilheteria Digital...");
  const checkouts = await CheckoutRepository.fetchCheckouts({
    paymentMethod: "bilheteria-digital",
  });
  console.log(`${checkouts.length} checkout(s) encontrado(s)\n`);

  let fixedDoc = 0;
  let fixedQr = 0;
  let skipped = 0;
  let errors = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      const label = `${checkout.id} / ${p.id} (${p.name || "sem nome"})`;

      try {
        const updates = {};

        // 1. Normalizar CPF
        const raw = p.document || p.cpf || "";
        const normalized = raw.replace(/\D/g, "");
        if (normalized && normalized !== raw) {
          updates.document = normalized;
          fixedDoc++;
        }

        // 2. Aplicar updates de document se houver
        if (Object.keys(updates).length > 0) {
          await db
            .collection("checkouts")
            .doc(checkout.id)
            .collection("participants")
            .doc(p.id)
            .update(updates);
          console.log(`  ✎  CPF normalizado: ${label}`);
        }

        // 3. Gerar (ou regenerar) qrToken
        // Regenera se: não tem token OU tem token com nome placeholder ("Participante N")
        // mas o participante já tem nome real preenchido
        const hasPlaceholderToken =
          p.qrToken &&
          p.name &&
          !/^Participante\s+\d+$/i.test(p.name) &&
          p.qrToken.includes('"participantName":"Participante');

        if (!p.qrToken || hasPlaceholderToken) {
          // Limpa token antigo antes de regenerar
          if (hasPlaceholderToken) {
            await db
              .collection("checkouts")
              .doc(checkout.id)
              .collection("participants")
              .doc(p.id)
              .update({ qrToken: null });
          }
          await CredentialService.generateQRCodesForParticipant(
            checkout.id,
            p.id,
            p.name || `Participante`
          );
          console.log(`  ✓  QR ${hasPlaceholderToken ? "regenerado" : "gerado"}: ${label}`);
          fixedQr++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗  Erro em ${label}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`CPFs normalizados : ${fixedDoc}`);
  console.log(`QRs gerados       : ${fixedQr}`);
  console.log(`Já tinham QR      : ${skipped}`);
  console.log(`Erros             : ${errors}`);
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
