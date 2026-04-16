/**
 * Script de migração — executa uma vez para adicionar o campo `isCourtesy`
 * (boolean, raiz do documento) em todos os checkouts.
 *
 * Regra:
 *   isCourtesy = true  → paymentDetails.courtesy === true
 *                        OU paymentDetails.paymentMethod === "courtesy"
 *   isCourtesy = false → qualquer outro checkout
 *
 * Como usar:
 *   node src/scripts/migrateIsCourtesy.js
 *
 * Flags:
 *   --dry-run   Apenas exibe o que seria alterado, sem gravar no Firestore.
 */

require("dotenv").config();
const { db } = require("../config").firebase;
const logger = require("../logger");

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 400; // Firestore suporta até 500 por batch

async function migrate() {
  logger.info(
    `[migrateIsCourtesy] Iniciando${DRY_RUN ? " (DRY-RUN — sem gravação)" : ""}...`
  );

  const snapshot = await db.collection("checkouts").get();
  const total = snapshot.size;
  logger.info(`[migrateIsCourtesy] ${total} checkout(s) encontrado(s).`);

  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    const isCourtesy =
      data.paymentDetails?.courtesy === true ||
      data.paymentDetails?.paymentMethod === "courtesy";

    // Pula se o campo já está correto para evitar writes desnecessários
    if (data.isCourtesy === isCourtesy) {
      skipped++;
      continue;
    }

    logger.info(
      `[migrateIsCourtesy] ${doc.id} → isCourtesy: ${isCourtesy} (era: ${data.isCourtesy})`
    );

    if (!DRY_RUN) {
      batch.update(doc.ref, { isCourtesy });
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        logger.info(`[migrateIsCourtesy] Batch de ${batchCount} gravado.`);
        batch = db.batch();
        batchCount = 0;
      }
    }

    updated++;
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    logger.info(`[migrateIsCourtesy] Batch final de ${batchCount} gravado.`);
  }

  logger.info(
    `[migrateIsCourtesy] Concluído. Atualizados: ${updated} | Já corretos (ignorados): ${skipped} | Total: ${total}`
  );
}

migrate().catch((err) => {
  logger.error(`[migrateIsCourtesy] Erro fatal: ${err.message}`);
  process.exit(1);
});
