/**
 * Script de migração — executa uma vez para mover todos os checkouts antigos
 * que ainda têm participants como array embutido para a nova subcoleção.
 *
 * Como usar:
 *   node src/scripts/migrateParticipants.js
 */

require("dotenv").config();
const { db, admin } = require("../config").firebase;
const { normalizeParticipant } = require("../utils/normalizeParticipant");
const logger = require("../logger");

async function migrateAll() {
  // Modo --force: apaga subcoleção existente e re-migra com dados atualizados
  const FORCE = process.argv.includes("--force");
  logger.info(
    `[Migration] Iniciando migração de participantes... ${
      FORCE ? "(MODO FORCE)" : ""
    }`
  );

  const snapshot = await db.collection("checkouts").get();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const checkoutDoc of snapshot.docs) {
    const data = checkoutDoc.data();

    // Só migra se ainda tem array embutido
    if (!Array.isArray(data.participants) || data.participants.length === 0) {
      skipped++;
      continue;
    }

    // Verifica se já existe subcoleção
    const subSnap = await checkoutDoc.ref
      .collection("participants")
      .limit(1)
      .get();

    if (!subSnap.empty) {
      if (!FORCE) {
        logger.info(
          `[Migration] Checkout ${checkoutDoc.id} já migrado, pulando (use --force para re-migrar)`
        );
        skipped++;
        continue;
      }

      // Modo force: apaga todos os participantes existentes antes de re-migrar
      logger.info(
        `[Migration] Checkout ${checkoutDoc.id} — apagando subcoleção existente (force mode)`
      );
      const allParticipants = await checkoutDoc.ref
        .collection("participants")
        .get();
      const deleteBatch = db.batch();
      allParticipants.docs.forEach((d) => deleteBatch.delete(d.ref));
      await deleteBatch.commit();
    }

    try {
      const batch = db.batch();
      const participants = data.participants;

      for (const p of participants) {
        const ref = checkoutDoc.ref.collection("participants").doc();

        // Dados legados podem ter "cpf", "document", "identity" ou nada
        // Montamos o objeto no formato que o normalizeParticipant espera
        const rawForNormalizer = {
          name: p.name || "",
          email: p.email || "",
          document: p.document || p.cpf || p.identity || p.Identity || "",
          phone: p.phone || p.number || p.telefone || "",
        };

        let normalized;
        try {
          normalized = normalizeParticipant(rawForNormalizer, {
            checkoutId: checkoutDoc.id,
            ticketType: p.ticketType || "full",
          });
        } catch (validationError) {
          // Dados legados podem estar incompletos — salva mesmo assim com flag de aviso
          logger.warn(
            `[Migration] Participante inválido em ${checkoutDoc.id}: ${validationError.message}`
          );
          normalized = {
            name: rawForNormalizer.name,
            email: rawForNormalizer.email,
            document: rawForNormalizer.document.replace(/\D/g, ""),
            phone: rawForNormalizer.phone.replace(/\D/g, ""),
            ticketType: p.ticketType || "full",
            checkoutId: checkoutDoc.id,
            qrToken: "",
            checkedIn: false,
            checkedInAt: null,
            checkedInDate: null,
            emailSent: false,
            emailSentAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            _migrationWarning: validationError.message,
          };
        }

        batch.set(ref, {
          ...normalized,
          // Preserva estado real do ano passado
          checkedIn: p.validated
            ? Object.values(p.validated).some(Boolean)
            : false,
          checkedInDate: p.validated
            ? Object.keys(p.validated).find((d) => p.validated[d]) || null
            : null,
          emailSent: p.emailSent || false,
          emailSentAt: p.emailSentAt || null,
          qrToken: p.qrRawData ? Object.values(p.qrRawData)[0] || "" : "",
          _legacy: p,
        });
      }

      // Marca o checkout como migrado (mantém array original para segurança)
      batch.update(checkoutDoc.ref, {
        _participantsMigrated: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();
      migrated += participants.length;
      logger.info(
        `[Migration] Checkout ${checkoutDoc.id}: ${participants.length} participantes migrados`
      );
    } catch (error) {
      errors++;
      logger.error(
        `[Migration] Erro no checkout ${checkoutDoc.id}: ${error.message}`
      );
    }
  }

  logger.info("─────────────────────────────────────────");
  logger.info(`[Migration] Concluída!`);
  logger.info(`  Participantes migrados : ${migrated}`);
  logger.info(`  Checkouts pulados      : ${skipped}`);
  logger.info(`  Erros                  : ${errors}`);
  logger.info("─────────────────────────────────────────");
  process.exit(0);
}

migrateAll().catch((err) => {
  logger.error("[Migration] Falha geral:", err.message);
  process.exit(1);
});
