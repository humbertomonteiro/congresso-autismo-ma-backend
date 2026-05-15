/**
 * Exporta CSV com participantes do Congresso Autismo MA 2025
 * que NÃO aparecem no Congresso Autismo MA 2026.
 *
 * Comparação por qualquer um dos campos:
 *   - Telefone normalizado (só dígitos)
 *   - Documento/CPF normalizado (só dígitos)
 *   - E-mail normalizado (lowercase)
 *
 * Saída: ausentes_2026_<timestamp>.csv  →  Nome,Telefone
 *
 * Uso:
 *   node src/utils/functions/export_ausentes_2026.js
 */

const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

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
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `550${digits}`;
};

const normalizePhone = (raw) => (raw || "").replace(/\D/g, "");
const normalizeDoc   = (raw) => (raw || "").replace(/\D/g, "");
const normalizeEmail = (raw) => (raw || "").trim().toLowerCase();

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const buildIdentitySets = (participants) => {
  const phones    = new Set();
  const documents = new Set();
  const emails    = new Set();

  for (const p of participants) {
    const phone = normalizePhone(p.phone || p._legacy?.phone || p._legacy?.number || "");
    const doc   = normalizeDoc(p.document || p.cpf || "");
    const email = normalizeEmail(p.email || "");

    if (phone)    phones.add(phone);
    if (doc)      documents.add(doc);
    if (email)    emails.add(email);
  }

  return { phones, documents, emails };
};

const isIn2026 = (p, sets) => {
  const phone = normalizePhone(p.phone || p._legacy?.phone || p._legacy?.number || "");
  const doc   = normalizeDoc(p.document || p.cpf || "");
  const email = normalizeEmail(p.email || "");

  return (
    (phone && sets.phones.has(phone)) ||
    (doc   && sets.documents.has(doc)) ||
    (email && sets.emails.has(email))
  );
};

const run = async () => {
  console.log("Buscando participantes de 2025...");
  const checkouts2025 = await CheckoutRepository.fetchCheckouts({
    status: "approved",
    eventName: "Congresso Autismo MA 2025",
  });
  console.log(`  ${checkouts2025.length} checkout(s) aprovado(s) em 2025`);

  console.log("Buscando participantes de 2026...");
  const checkouts2026 = await CheckoutRepository.fetchCheckouts({
    status: "approved",
    eventName: "Congresso Autismo MA 2026",
  });
  console.log(`  ${checkouts2026.length} checkout(s) aprovado(s) em 2026\n`);

  // Montar sets de identidade dos participantes de 2026
  const participants2026 = [];
  for (const checkout of checkouts2026) {
    const ps = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
    participants2026.push(...ps);
  }
  const sets2026 = buildIdentitySets(participants2026);
  console.log(`Participantes 2026 indexados: ${participants2026.length}`);

  // Percorrer 2025 e filtrar ausentes
  const rows = [];
  let excludedCount  = 0;
  let noPhoneCount   = 0;
  let alreadyIn2026  = 0;

  for (const checkout of checkouts2025) {
    if (shouldExclude(checkout.observation)) {
      const ps = await CheckoutRepository.getParticipantsByCheckout(checkout.id);
      excludedCount += ps.length;
      console.log(`  ⊘  Excluído checkout ${checkout.id} (obs: "${checkout.observation}") — ${ps.length} participante(s)`);
      continue;
    }

    const participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    for (const p of participants) {
      if (isIn2026(p, sets2026)) {
        alreadyIn2026++;
        continue;
      }

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
    console.log("\nNenhum participante ausente encontrado.");
    return;
  }

  const lines = ["Nome,Telefone"];
  for (const r of rows) {
    lines.push(`${escapeCsv(r.nome)},${escapeCsv(r.telefone)}`);
  }

  const fileName = `ausentes_2026_${Date.now()}.csv`;
  const outputPath = path.resolve(__dirname, fileName);
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Participantes 2025 aprovados : ${participants2026.length + rows.length + excludedCount + noPhoneCount + alreadyIn2026}`);
  console.log(`Já presentes em 2026         : ${alreadyIn2026}`);
  console.log(`Excluídos (obs.)             : ${excludedCount}`);
  console.log(`Sem telefone (ignorados)     : ${noPhoneCount}`);
  console.log(`Ausentes exportados          : ${rows.length}`);
  console.log(`Arquivo                      : ${outputPath}`);
};

run().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
