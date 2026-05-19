/**
 * Gera qrToken para participantes que receberam uma transferência de ingresso
 * mas ainda não têm qrToken — necessário para emitir ingresso e fazer check-in.
 *
 * Lógica:
 *   - Participante com `transferredFrom` definido = novo titular de uma transferência
 *   - Se não tiver `qrToken`, gera via CredentialService
 *   - Participantes com `status: "transferred"` (antigos titulares) são ignorados
 *
 * Uso:
 *   node src/utils/functions/fix_transferred_qr.js
 */

const CheckoutRepository = require("../../repositories/CheckoutRepository");
const CredentialService = require("../../services/CredentialService");
const { firebase } = require("../../config");

const { db } = firebase;

const run = async () => {
  console.log("Buscando checkouts aprovados...");
  const checkouts = await CheckoutRepository.fetchCheckouts({ status: "approved" });
  console.log(`${checkouts.length} checkout(s) encontrado(s)\n`);

  let checked = 0;
  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      // Apenas novos titulares de transferência
      if (!p.transferredFrom) continue;

      checked++;
      const label = `${checkout.id} / ${p.id} (${p.name || "sem nome"})`;

      try {
        if (p.qrToken) {
          skipped++;
          continue;
        }

        await CredentialService.generateQRCodesForParticipant(
          checkout.id,
          p.id,
          p.name || "Participante"
        );
        console.log(`  ✓  QR gerado: ${label}`);
        generated++;
      } catch (err) {
        console.error(`  ✗  Erro em ${label}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Transferidos encontrados : ${checked}`);
  console.log(`QRs gerados              : ${generated}`);
  console.log(`Já tinham QR             : ${skipped}`);
  console.log(`Erros                    : ${errors}`);
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
