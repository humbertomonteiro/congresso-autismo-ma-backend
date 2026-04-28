/**
 * Exporta CSV para envio em massa via WhatsApp (Poli Digital).
 *
 * Regras:
 *  - Apenas checkouts com status "approved" e eventName "Congresso Autismo MA 2025"
 *  - Exclui participantes cujo checkout contenha qualquer termo em EXCLUDED_TERMS
 *  - Telefone no formato: 55 + 0 + DDD + número  (ex.: 55098987654321)
 *  - Colunas: Nome,Telefone
 *
 * Uso:
 *   node src/utils/functions/export_csv_whatsapp.js
 */

const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

// Termos que, se aparecerem na observação do checkout, excluem o participante
const EXCLUDED_TERMS = [
  "governo do estado",
  "colinas",
  "cortesias vivian",
  "vivian",
];

const shouldExclude = (observation) => {
  const obs = (observation || "").toLowerCase();
  return EXCLUDED_TERMS.some((term) => obs.includes(term));
};

const formatPhone = (raw) => {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  // Já inclui DDI 55
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  // Adiciona 55 + 0 na frente do DDD
  return `550${digits}`;
};

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const run = async () => {
  console.log("Buscando checkouts aprovados...\n");

  const checkouts = await CheckoutRepository.fetchCheckouts({
    status: "approved",
    eventName: "Congresso Autismo MA 2025",
  });
  console.log(`${checkouts.length} checkout(s) aprovado(s) encontrado(s).`);

  const rows = [];
  let excludedCount = 0;
  let noPhoneCount = 0;

  for (const checkout of checkouts) {
    if (shouldExclude(checkout.observation)) {
      const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
      excludedCount += participants.length;
      console.log(
        `  ⊘  Checkout ${checkout.id} excluído (obs: "${checkout.observation}") — ${participants.length} participante(s)`
      );
      continue;
    }

    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      const rawPhone = p.phone || p._legacy?.phone || p._legacy?.number || "";
      const phone = formatPhone(rawPhone);

      if (!phone) {
        console.log(`  ⚠  Sem telefone: ${p.name} (checkout ${checkout.id})`);
        noPhoneCount++;
        continue;
      }

      rows.push({ nome: p.name || "", telefone: phone });
    }
  }

  if (rows.length === 0) {
    console.log("\nNenhum participante encontrado para exportar.");
    return;
  }

  const lines = ["Nome,Telefone"];
  for (const r of rows) {
    lines.push(`${escapeCsv(r.nome)},${escapeCsv(r.telefone)}`);
  }

  const fileName = `whatsapp_${Date.now()}.csv`;
  const outputPath = path.resolve(__dirname, fileName);
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Exportados   : ${rows.length}`);
  console.log(`Excluídos    : ${excludedCount}`);
  console.log(`Sem telefone : ${noPhoneCount}`);
  console.log(`Arquivo      : ${outputPath}`);
};

run().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
