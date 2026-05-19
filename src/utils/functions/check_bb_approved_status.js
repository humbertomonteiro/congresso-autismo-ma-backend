/**
 * Verifica se checkouts marcados como "approved" no Firestore realmente estão
 * aprovados no Banco do Brasil (boleto e PIX).
 *
 * O que faz:
 *   1. Busca todos os checkouts com status "approved" e paymentMethod boleto ou pix
 *   2. Consulta o status real na API do BB para cada um
 *   3. Reporta qualquer divergência (ex: Firestore=approved, BB=expired)
 *   4. Com flag --fix: atualiza o status no Firestore para o valor correto
 *
 * Uso:
 *   node src/utils/functions/check_bb_approved_status.js
 *   node src/utils/functions/check_bb_approved_status.js --fix
 */

require("dotenv").config();
const CheckoutRepository = require("../../repositories/CheckoutRepository");
const BancoDoBrasilService = require("../../services/BancoDoBrasilService");

const FIX = process.argv.includes("--fix");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  console.log(`Modo: ${FIX ? "VERIFICAR + CORRIGIR" : "apenas verificar (use --fix para corrigir)"}\n`);

  // ── Boletos ────────────────────────────────────────────────────────────────
  console.log("Buscando checkouts aprovados por boleto...");
  const boletos = await CheckoutRepository.fetchCheckouts({
    status: "approved",
    paymentMethod: "boleto",
  });
  console.log(`  ${boletos.length} checkout(s) encontrado(s)\n`);

  // ── PIX ───────────────────────────────────────────────────────────────────
  console.log("Buscando checkouts aprovados por PIX...");
  const pixCheckouts = await CheckoutRepository.fetchCheckouts({
    status: "approved",
    paymentMethod: "pix",
  });
  console.log(`  ${pixCheckouts.length} checkout(s) encontrado(s)\n`);

  const checkouts = [...boletos, ...pixCheckouts];

  if (checkouts.length === 0) {
    console.log("Nenhum checkout para verificar.");
    return;
  }

  console.log(`Consultando API do BB para ${checkouts.length} checkout(s)...\n`);

  const divergencias = [];
  let ok = 0;
  let erros = 0;

  for (const checkout of checkouts) {
    const { id, paymentMethod, paymentId } = checkout;
    if (!paymentId) {
      console.log(`  ⚠  ${id} sem paymentId — ignorado`);
      continue;
    }

    try {
      let bbStatus;
      if (paymentMethod === "boleto") {
        bbStatus = await BancoDoBrasilService.getBoletoStatus(paymentId);
      } else {
        bbStatus = await BancoDoBrasilService.getPixStatus(paymentId);
      }

      if (bbStatus !== "approved") {
        divergencias.push({ id, paymentMethod, paymentId, bbStatus, checkout });
        console.log(
          `  ✗  ${id} | ${paymentMethod} | paymentId: ${paymentId} → BB diz: ${bbStatus}`
        );

        if (FIX) {
          await CheckoutRepository.updateCheckoutStatus(id, bbStatus);
          console.log(`     → Status atualizado para "${bbStatus}" no Firestore`);
        }
      } else {
        ok++;
      }

      // Pequena pausa para não sobrecarregar a API do BB
      await sleep(300);
    } catch (err) {
      console.error(`  ✗  ${id} | erro ao consultar BB: ${err.message}`);
      erros++;
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Verificados          : ${checkouts.length}`);
  console.log(`OK (approved no BB)  : ${ok}`);
  console.log(`Com divergência      : ${divergencias.length}`);
  console.log(`Erros de consulta    : ${erros}`);

  if (divergencias.length > 0) {
    console.log(`\n─── Divergências ────────────────────────`);
    divergencias.forEach(({ id, paymentMethod, paymentId, bbStatus }) => {
      console.log(
        `  • checkout ${id} | ${paymentMethod} | ${paymentId} → ${bbStatus}`
      );
    });

    if (!FIX) {
      console.log(`\nRodando com --fix esses ${divergencias.length} status serão corrigidos no Firestore.`);
    }
  }
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
