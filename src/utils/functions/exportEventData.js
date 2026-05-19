/**
 * Exporta todos os checkouts aprovados de um evento para um JSON estático.
 * O arquivo é salvo em frontend/public/data/<slug>_latest.json e servido
 * como asset estático — sem nenhuma leitura no Firestore após o deploy.
 *
 * O EventCacheService.js já consome esse formato automaticamente.
 * Após gerar o JSON, adicione o eventName em CACHED_EVENTS no
 * frontend/src/data/services/certificateService.js.
 *
 * Uso:
 *   node src/utils/functions/exportEventData.js
 *       → exporta 2025 E 2026
 *
 *   node src/utils/functions/exportEventData.js "Congresso Autismo MA 2025"
 *       → exporta apenas o evento informado
 *
 *   node src/utils/functions/exportEventData.js --all-statuses
 *       → inclui checkouts de todos os status (não só approved)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

const ALL_STATUSES = process.argv.includes("--all-statuses");

// Eventos a exportar por padrão (quando nenhum argumento é passado)
const DEFAULT_EVENTS = [
  "Congresso Autismo MA 2025",
  "Congresso Autismo MA 2026",
];

const slugify = (str) =>
  str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");

// Resolve o caminho de saída: backend/backups/ (local only, nunca deployado)
const OUTPUT_DIR = path.resolve(__dirname, "../../../backups");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serializa valores Firestore (Timestamp, etc.) para JSON puro.
 */
function serializeValue(value) {
  if (value === null || value === undefined) return null;
  // Timestamp do Firestore Admin SDK
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeValue(v)])
    );
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  return value;
}

function serializeDoc(doc) {
  return Object.fromEntries(
    Object.entries(doc).map(([k, v]) => [k, serializeValue(v)])
  );
}

async function exportEvent(eventName) {
  console.log(`\n── Exportando: "${eventName}" ──────────────────────────`);

  // Busca apenas checkouts approved (ou todos com --all-statuses)
  let checkouts;
  if (ALL_STATUSES) {
    checkouts = await CheckoutRepository.fetchCheckouts({ eventName });
  } else {
    checkouts = await CheckoutRepository.fetchCheckouts({
      eventName,
      status: "approved",
    });
  }

  console.log(`  ${checkouts.length} checkout(s) encontrado(s)`);

  if (checkouts.length === 0) {
    console.log(`  Nenhum checkout — arquivo não gerado.`);
    return;
  }

  const result = [];
  let totalParticipants = 0;

  for (let i = 0; i < checkouts.length; i++) {
    const checkout = checkouts[i];

    // Participantes via subcoleção (modelo 2026+)
    let participants = await CheckoutRepository.getParticipantsByCheckout(checkout.id);

    // Fallback: participantes inline no documento (modelo legado 2025)
    if (participants.length === 0 && Array.isArray(checkout.participants)) {
      participants = checkout.participants;
    }

    totalParticipants += participants.length;

    result.push(
      serializeDoc({
        ...checkout,
        participants: participants.map(serializeDoc),
      })
    );

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  ${i + 1}/${checkouts.length} checkouts processados...\r`);
      await sleep(50); // respeita os limites do Firestore
    }
  }

  const slug = slugify(eventName);
  const filename = `${slug}_latest.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = {
    exportedAt: new Date().toISOString(),
    eventName,
    totalCheckouts: result.length,
    totalParticipants,
    checkouts: result,
  };

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");

  const fileSizeKb = (fs.statSync(filepath).size / 1024).toFixed(1);
  console.log(`  ✓ Checkouts  : ${result.length}`);
  console.log(`  ✓ Participantes: ${totalParticipants}`);
  console.log(`  ✓ Arquivo    : ${filepath}`);
  console.log(`  ✓ Tamanho    : ${fileSizeKb} KB`);
}

const run = async () => {
  // Evento passado como argumento CLI (ignora flags --xxx)
  const eventArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const events = eventArg ? [eventArg] : DEFAULT_EVENTS;

  console.log(`Modo: ${ALL_STATUSES ? "todos os status" : "apenas approved"}`);
  console.log(`Destino: ${OUTPUT_DIR}`);

  for (const eventName of events) {
    await exportEvent(eventName);
  }

  console.log("\n─── Concluído ───────────────────────────────────────────");
  console.log("Próximo passo: adicione os eventos exportados em CACHED_EVENTS");
  console.log("  frontend/src/data/services/certificateService.js");
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
