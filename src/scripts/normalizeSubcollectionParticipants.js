/**
 * Script de normalização — padroniza participantes JÁ na subcoleção.
 *
 * Usa quando os participantes foram migrados (ou salvos) com campos não-padrão:
 *   cpf / identity / Identity  →  document
 *   number / telefone          →  phone
 *   qrRawData / qrCodes        →  removidos (legado)
 *
 * Modo seco (padrão): mostra o que seria alterado sem gravar.
 * Modo real:           node src/scripts/normalizeSubcollectionParticipants.js --write
 * Checkout específico: node src/scripts/normalizeSubcollectionParticipants.js --write --checkout <id>
 */

require("dotenv").config();
const { db, admin } = require("../config").firebase;
const logger = require("../logger");

const DRY_RUN = !process.argv.includes("--write");
const TARGET_CHECKOUT = (() => {
  const idx = process.argv.indexOf("--checkout");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// Campos legados que devem ser removidos após normalização
const LEGACY_FIELDS = [
  "cpf",
  "identity",
  "Identity",
  "qrRawData",
  "qrCodes",
  "validated",
  "number",
  "telefone",
];

function normalizeDoc(raw) {
  return (
    raw.document ||
    raw.cpf ||
    raw.identity ||
    raw.Identity ||
    ""
  ).replace(/\D/g, "");
}

function normalizePhone(raw) {
  return (raw.phone || raw.number || raw.telefone || "").replace(/\D/g, "");
}

// Retorna o patch (campos a atualizar) e uma lista de campos a deletar
function buildPatch(data) {
  const patch = {};
  const toDelete = {};

  // document
  const doc = normalizeDoc(data);
  if (doc !== data.document) {
    patch.document = doc;
  }

  // phone
  const phone = normalizePhone(data);
  if (phone !== data.phone) {
    patch.phone = phone;
  }

  // name
  const name = (data.name || "").trim();
  if (name !== data.name) patch.name = name;

  // email
  const email = (data.email || "").trim().toLowerCase();
  if (email !== data.email) patch.email = email;

  // ticketType — garante que existe
  if (!data.ticketType) patch.ticketType = "full";

  // campos booleanos/nulos que devem existir
  if (data.checkedIn === undefined) patch.checkedIn = false;
  if (data.checkedInAt === undefined) patch.checkedInAt = null;
  if (data.checkedInDate === undefined) patch.checkedInDate = null;
  if (data.emailSent === undefined) patch.emailSent = false;
  if (data.emailSentAt === undefined) patch.emailSentAt = null;
  if (data.qrToken === undefined) patch.qrToken = "";

  // marca campos legados para remoção
  for (const field of LEGACY_FIELDS) {
    if (field in data) {
      toDelete[field] = admin.firestore.FieldValue.delete();
    }
  }

  return { patch, toDelete };
}

async function run() {
  logger.info(
    `[Normalize] Iniciando... ${
      DRY_RUN ? "(DRY RUN — use --write para gravar)" : "(MODO ESCRITA)"
    }`
  );
  if (TARGET_CHECKOUT) {
    logger.info(`[Normalize] Processando apenas checkout: ${TARGET_CHECKOUT}`);
  }

  const checkoutsRef = TARGET_CHECKOUT
    ? db
        .collection("checkouts")
        .where(admin.firestore.FieldPath.documentId(), "==", TARGET_CHECKOUT)
    : db.collection("checkouts");

  const checkoutSnap = await checkoutsRef.get();

  let totalCheckouts = 0;
  let totalParticipants = 0;
  let needsUpdate = 0;
  let updated = 0;
  let errors = 0;

  for (const checkoutDoc of checkoutSnap.docs) {
    totalCheckouts++;
    const participantsSnap = await checkoutDoc.ref
      .collection("participants")
      .get();

    if (participantsSnap.empty) continue;

    for (const pDoc of participantsSnap.docs) {
      totalParticipants++;
      const data = pDoc.data();
      const { patch, toDelete } = buildPatch(data);
      const hasPatch = Object.keys(patch).length > 0;
      const hasDelete = Object.keys(toDelete).length > 0;

      if (!hasPatch && !hasDelete) continue;

      needsUpdate++;

      logger.info(
        `[Normalize] Checkout ${checkoutDoc.id} / Participante ${pDoc.id} (${
          data.name || "?"
        })`
      );
      if (hasPatch) {
        logger.info(`  Patch: ${JSON.stringify(patch)}`);
      }
      if (hasDelete) {
        logger.info(`  Remover: ${Object.keys(toDelete).join(", ")}`);
      }

      if (!DRY_RUN) {
        try {
          await pDoc.ref.update({ ...patch, ...toDelete });
          updated++;
        } catch (err) {
          errors++;
          logger.error(
            `[Normalize] Erro ao atualizar ${pDoc.id}: ${err.message}`
          );
        }
      }
    }
  }

  logger.info("─────────────────────────────────────────");
  logger.info(`[Normalize] Concluído!`);
  logger.info(`  Checkouts processados  : ${totalCheckouts}`);
  logger.info(`  Participantes lidos    : ${totalParticipants}`);
  logger.info(`  Precisam de ajuste     : ${needsUpdate}`);
  if (!DRY_RUN) {
    logger.info(`  Atualizados            : ${updated}`);
    logger.info(`  Erros                  : ${errors}`);
  } else {
    logger.info(`  (nada gravado — rode com --write para aplicar)`);
  }
  logger.info("─────────────────────────────────────────");
  process.exit(0);
}

run().catch((err) => {
  logger.error("[Normalize] Falha geral:", err.message);
  process.exit(1);
});
