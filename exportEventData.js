/**
 * exportEventData.js
 *
 * Exporta todos os checkouts + participantes de um evento específico do Firestore
 * para um arquivo JSON local. Use este script para gerar um snapshot e evitar
 * leituras repetidas no Firebase.
 *
 * Uso:
 *   node exportEventData.js
 *   node exportEventData.js "Congresso Autismo MA 2025"
 *
 * O arquivo gerado é salvo em:
 *   ./exported_data/<slug>_<timestamp>.json  (histórico)
 *   ./exported_data/<slug>_latest.json       (sempre o mais recente)
 *   ../frontend/public/data/<slug>_latest.json  (usado pelo frontend como cache)
 */

const fs = require("fs");
const path = require("path");
const { db } = require("./src/config").firebase;

// ── Configuração ─────────────────────────────────────────────────────────────
const EVENT_NAME = process.argv[2] || "Congresso Autismo MA 2025";
const OUTPUT_DIR = path.join(__dirname, "exported_data");
const FRONTEND_PUBLIC_DIR = path.join(__dirname, "../frontend/public/data");
// ─────────────────────────────────────────────────────────────────────────────

const slugify = (str) =>
  str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");

/** Normaliza todos os Timestamps do Firestore para strings ISO */
const normalizeTimestamps = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj.toDate === "function") return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(normalizeTimestamps);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, normalizeTimestamps(v)])
    );
  }
  return obj;
};

/** Busca participantes da subcoleção; retorna [] se não houver */
const fetchSubcollectionParticipants = async (checkoutId) => {
  const snap = await db
    .collection("checkouts")
    .doc(checkoutId)
    .collection("participants")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...normalizeTimestamps(d.data()) }));
};

const main = async () => {
  console.log(`\n📦 Exportando dados do evento: "${EVENT_NAME}"\n`);

  // ── 1. Busca checkouts do evento ──────────────────────────────────────────
  const snapshot = await db
    .collection("checkouts")
    .where("eventName", "==", EVENT_NAME)
    .get();

  if (snapshot.empty) {
    console.warn(`⚠️  Nenhum checkout encontrado para o evento "${EVENT_NAME}".`);
    console.warn(
      "   Verifique se o nome do evento está correto (incluindo maiúsculas e acentos)."
    );
    process.exit(0);
  }

  console.log(`✅ ${snapshot.docs.length} checkout(s) encontrado(s).`);

  // ── 2. Enriquece cada checkout com participantes ──────────────────────────
  const checkouts = [];
  let totalParticipants = 0;

  for (const docSnap of snapshot.docs) {
    const data = normalizeTimestamps(docSnap.data());
    const checkoutId = docSnap.id;

    // Legado: participants embutidos como array
    let participants = [];
    if (Array.isArray(data.participants) && data.participants.length > 0) {
      participants = data.participants;
    } else {
      // Novo modelo: subcoleção participants
      participants = await fetchSubcollectionParticipants(checkoutId);
    }

    totalParticipants += participants.length;

    checkouts.push({
      id: checkoutId,
      ...data,
      participants, // garante que participants está sempre no campo correto
    });

    process.stdout.write(
      `\r   Processando checkouts: ${checkouts.length}/${snapshot.docs.length} (${totalParticipants} participantes)...`
    );
  }

  console.log("\n");

  // ── 3. Monta o documento de saída ─────────────────────────────────────────
  const output = {
    exportedAt: new Date().toISOString(),
    eventName: EVENT_NAME,
    totalCheckouts: checkouts.length,
    totalParticipants,
    checkouts,
  };

  // ── 4. Salva o arquivo JSON ───────────────────────────────────────────────
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const slug = slugify(EVENT_NAME);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${slug}_${timestamp}.json`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  const jsonContent = JSON.stringify(output, null, 2);

  fs.writeFileSync(outputPath, jsonContent, "utf8");

  // Também salva como "latest" no diretório do backend
  const latestPath = path.join(OUTPUT_DIR, `${slug}_latest.json`);
  fs.writeFileSync(latestPath, jsonContent, "utf8");

  // Copia para frontend/public/data/ para uso como cache estático no browser
  if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
    fs.mkdirSync(FRONTEND_PUBLIC_DIR, { recursive: true });
  }
  const frontendLatestPath = path.join(FRONTEND_PUBLIC_DIR, `${slug}_latest.json`);
  fs.writeFileSync(frontendLatestPath, jsonContent, "utf8");

  console.log(`✅ Arquivo salvo em:`);
  console.log(`   ${outputPath}`);
  console.log(`   ${latestPath}  ← backend latest (sobrescrita a cada export)`);
  console.log(`   ${frontendLatestPath}  ← frontend cache (usado pelo browser)`);
  console.log(`\n📊 Resumo:`);
  console.log(`   Evento:         ${EVENT_NAME}`);
  console.log(`   Checkouts:      ${checkouts.length}`);
  console.log(`   Participantes:  ${totalParticipants}`);

  const byStatus = checkouts.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`   ${status.padEnd(12)} ${count}`);
  });

  console.log("\n🏁 Exportação concluída.\n");
  process.exit(0);
};

main().catch((err) => {
  console.error("\n❌ Erro durante a exportação:", err.message);
  process.exit(1);
});
