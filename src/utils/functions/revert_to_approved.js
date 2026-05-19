/**
 * Reverte checkouts de boleto/pix de "expired"/"pending" de volta para "approved".
 *
 * Uso:
 *   node src/utils/functions/revert_to_approved.js
 *       → lista checkouts afetados e instrui como proceder
 *
 *   node src/utils/functions/revert_to_approved.js --all
 *       → reverte TODOS os boleto/pix com status expired/pending que têm participantes
 *
 *   node src/utils/functions/revert_to_approved.js affected_checkouts_1234567890.json
 *       → reverte apenas os IDs listados no arquivo de diagnóstico
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loadFromFile = (filename) => {
  const filepath = path.isAbsolute(filename)
    ? filename
    : path.join(__dirname, filename);

  if (!fs.existsSync(filepath)) {
    console.error(`Arquivo não encontrado: ${filepath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filepath, "utf8");
  return JSON.parse(raw);
};

const fetchAllAffected = async () => {
  const combos = [
    { paymentMethod: "boleto", status: "expired" },
    { paymentMethod: "boleto", status: "pending" },
    { paymentMethod: "pix", status: "expired" },
    { paymentMethod: "pix", status: "pending" },
  ];

  const all = [];
  for (const filters of combos) {
    const results = await CheckoutRepository.fetchCheckouts(filters);
    all.push(...results);
  }

  const affected = [];
  for (const checkout of all) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
    if (participants.length === 0) continue;
    affected.push({
      id: checkout.id,
      status: checkout.status,
      paymentMethod: checkout.paymentMethod,
      buyerName: checkout.buyerName || checkout.name || "(sem nome)",
      participantCount: participants.length,
    });
  }

  return affected;
};

const run = async () => {
  const args = process.argv.slice(2);
  const useAll = args.includes("--all");
  const jsonArg = args.find((a) => a.endsWith(".json"));

  // ── Modo listagem (sem argumentos) ────────────────────────────────────────
  if (!useAll && !jsonArg) {
    console.log("Buscando checkouts afetados...\n");
    const affected = await fetchAllAffected();

    if (affected.length === 0) {
      console.log("Nenhum checkout afetado encontrado.");
      return;
    }

    console.log(`${affected.length} checkout(s) seriam revertidos para "approved":\n`);
    affected.forEach(({ id, status, paymentMethod, buyerName, participantCount }) => {
      console.log(`  • ${id} | ${paymentMethod} | ${status} | ${participantCount} participante(s) | ${buyerName}`);
    });

    console.log(`\nPara reverter, rode:`);
    console.log(`  node src/utils/functions/revert_to_approved.js --all`);
    console.log(`  — ou primeiro diagnostique com —`);
    console.log(`  node src/utils/functions/diagnose_bb_status_change.js`);
    return;
  }

  // ── Modo reversão ─────────────────────────────────────────────────────────
  let toRevert;

  if (jsonArg) {
    console.log(`Carregando lista do arquivo: ${jsonArg}\n`);
    const raw = loadFromFile(jsonArg);

    // Checkouts com paymentId "MANUAL_xxx" estavam pending ANTES do script
    // check_bb_approved_status.js --fix (que só processa status "approved").
    // Revertê-los seria marcar como "approved" ingressos não confirmados.
    const skipped = raw.filter((c) => String(c.paymentId || "").startsWith("MANUAL_"));
    toRevert = raw.filter((c) => !String(c.paymentId || "").startsWith("MANUAL_"));

    if (skipped.length > 0) {
      console.log(`⚠  ${skipped.length} entrada(s) com paymentId MANUAL_ ignoradas (eram pending antes do script).\n`);
    }
    console.log(`${toRevert.length} checkout(s) serão revertidos.\n`);
  } else {
    console.log("Buscando todos os checkouts afetados (--all)...\n");
    toRevert = await fetchAllAffected();
    console.log(`${toRevert.length} checkout(s) encontrado(s).\n`);
  }

  if (toRevert.length === 0) {
    console.log("Nenhum checkout para reverter.");
    return;
  }

  console.log(`Revertendo ${toRevert.length} checkout(s) para "approved"...\n`);

  let ok = 0;
  let erros = 0;

  for (const { id, buyerName } of toRevert) {
    try {
      await CheckoutRepository.updateCheckoutStatus(id, "approved");
      console.log(`  ✓  ${id} | ${buyerName || id} → approved`);
      ok++;
      await sleep(100);
    } catch (err) {
      console.error(`  ✗  ${id} | erro: ${err.message}`);
      erros++;
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Revertidos com sucesso : ${ok}`);
  console.log(`Erros                  : ${erros}`);

  if (ok > 0) {
    console.log(`\nPróximo passo: abra o dashboard e clique em "Atualizar Métricas".`);
    console.log(`O total de participantes deve voltar ao valor anterior.`);
  }
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
