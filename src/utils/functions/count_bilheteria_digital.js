/**
 * Conta participantes importados da Bilheteria Digital.
 *
 * Uso:
 *   node src/utils/functions/count_bilheteria_digital.js
 */

const CheckoutRepository = require("../../repositories/CheckoutRepository");

const run = async () => {
  console.log("Buscando checkouts da Bilheteria Digital...");
  const checkouts = await CheckoutRepository.fetchCheckouts({
    paymentMethod: "bilheteria-digital",
  });
  console.log(`${checkouts.length} checkout(s) encontrado(s)\n`);

  let total = 0;
  let comNome = 0;
  let semNome = 0;
  let comQr = 0;
  let semQr = 0;

  for (const checkout of checkouts) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
    for (const p of participants) {
      total++;
      const temNome = p.name && !/^Participante\s+\d+$/i.test(p.name);
      temNome ? comNome++ : semNome++;
      p.qrToken ? comQr++ : semQr++;
    }
  }

  console.log(`─── Resultado ───────────────────────────`);
  console.log(`Total de participantes : ${total}`);
  console.log(`Com nome real          : ${comNome}`);
  console.log(`Sem nome (placeholder) : ${semNome}`);
  console.log(`Com QR Code            : ${comQr}`);
  console.log(`Sem QR Code            : ${semQr}`);
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
