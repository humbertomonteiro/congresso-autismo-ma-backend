/**
 * Migração: copia _legacy.phone → phone em todos os participantes
 * que estão com o campo phone vazio/nulo.
 *
 * Uso:
 *   node src/utils/functions/migrate_phone_from_legacy.js
 *
 * Flags:
 *   --dry-run   Apenas exibe o que seria alterado, sem gravar no Firestore.
 */

const CheckoutRepository = require("../../repositories/CheckoutRepository");

const isDryRun = process.argv.includes("--dry-run");

const isEmpty = (value) => !value || value.toString().trim() === "" || value === "0";

const run = async () => {
  if (isDryRun) console.log("[ DRY RUN — nenhuma alteração será salva ]\n");

  console.log("Buscando todos os checkouts...\n");
  const checkouts = await CheckoutRepository.fetchCheckouts();
  console.log(`${checkouts.length} checkout(s) encontrado(s).\n`);

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      totalChecked++;

      const legacyPhone = p._legacy?.phone || p._legacy?.number || "";

      if (!isEmpty(p.phone)) {
        totalSkipped++;
        continue;
      }

      if (isEmpty(legacyPhone)) {
        console.log(`  ⚠  ${p.name} (${p.id}) — sem _legacy.phone, pulando.`);
        totalSkipped++;
        continue;
      }

      console.log(`  ✓  ${p.name} | phone: "${p.phone || "(vazio)"}" → "${legacyPhone}"`);

      if (!isDryRun) {
        await CheckoutRepository.updateParticipant(checkout.id, p.id, { phone: legacyPhone });
      }

      totalUpdated++;
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Participantes verificados : ${totalChecked}`);
  console.log(`Atualizados               : ${totalUpdated}`);
  console.log(`Ignorados                 : ${totalSkipped}`);
  if (isDryRun) console.log("\n[ DRY RUN — nenhuma alteração foi salva ]");
};

run().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
