/**
 * Diagnostica checkouts de boleto/pix que podem ter sido revertidos
 * incorretamente de "approved" para "expired"/"pending" pelo script
 * check_bb_approved_status.js --fix.
 *
 * O que faz:
 *   1. Busca todos os checkouts boleto/pix com status "expired" ou "pending"
 *   2. Para cada um, verifica se há participantes na subcoleção
 *   3. Exibe um resumo e salva a lista em affected_checkouts_<timestamp>.json
 *      para uso posterior pelo script revert_to_approved.js
 *
 * Uso:
 *   node src/utils/functions/diagnose_bb_status_change.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

const run = async () => {
  const combos = [
    { paymentMethod: "boleto", status: "expired" },
    { paymentMethod: "boleto", status: "pending" },
    { paymentMethod: "pix", status: "expired" },
    { paymentMethod: "pix", status: "pending" },
  ];

  console.log("Buscando checkouts boleto/pix com status expired ou pending...\n");

  const allCheckouts = [];
  for (const filters of combos) {
    const results = await CheckoutRepository.fetchCheckouts(filters);
    if (results.length > 0) {
      console.log(`  ${filters.paymentMethod} + ${filters.status}: ${results.length} checkout(s)`);
    }
    allCheckouts.push(...results);
  }

  console.log(`\nTotal encontrado: ${allCheckouts.length} checkout(s)\n`);

  if (allCheckouts.length === 0) {
    console.log("Nenhum checkout para diagnosticar.");
    return;
  }

  console.log("Verificando participantes em cada checkout...\n");

  const affected = [];
  let semParticipantes = 0;

  for (const checkout of allCheckouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
    if (participants.length === 0) {
      semParticipantes++;
      continue;
    }

    const entry = {
      id: checkout.id,
      status: checkout.status,
      paymentMethod: checkout.paymentMethod,
      paymentId: checkout.paymentId || null,
      buyerName: checkout.buyerName || checkout.name || "(sem nome)",
      buyerEmail: checkout.buyerEmail || checkout.email || "",
      totalAmount: checkout.totalAmount || 0,
      participantCount: participants.length,
    };

    affected.push(entry);

    console.log(
      `  • ${entry.id} | ${entry.paymentMethod} | ${entry.status} | ${entry.participantCount} participante(s) | ${entry.buyerName}`
    );
  }

  console.log(`\n─── Resumo ──────────────────────────────`);
  console.log(`Total consultados         : ${allCheckouts.length}`);
  console.log(`Com participantes (afetados): ${affected.length}`);
  console.log(`Sem participantes (ignorados): ${semParticipantes}`);

  if (affected.length === 0) {
    console.log("\nNenhum checkout afetado encontrado.");
    return;
  }

  const timestamp = Date.now();
  const filename = `affected_checkouts_${timestamp}.json`;
  const filepath = path.join(__dirname, filename);

  fs.writeFileSync(filepath, JSON.stringify(affected, null, 2), "utf8");
  console.log(`\nArquivo salvo: ${filepath}`);
  console.log(`\nPróximo passo:`);
  console.log(`  node src/utils/functions/revert_to_approved.js ${filename}`);
  console.log(`  — ou —`);
  console.log(`  node src/utils/functions/revert_to_approved.js --all`);
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
