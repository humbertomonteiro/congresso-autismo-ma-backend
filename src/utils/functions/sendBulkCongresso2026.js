/**
 * sendBulkCongresso2026.js
 *
 * Envia e-mail de divulgação do 4º Congresso Salud de Autismo para todos os
 * participantes de checkouts aprovados do evento "Congresso Autismo MA 2025",
 * excluindo checkouts com observation === "vivian" (case-insensitive).
 *
 * Uso:
 *   node scripts/sendBulkCongresso2026.js
 *
 * Flags opcionais:
 *   --dry-run   Simula o envio sem chamar a API do Resend
 *   --limit N   Limita o envio a N participantes (útil pra teste)
 */

require("dotenv").config();

const { db, admin } = require("../../config").firebase;
const { Resend } = require("resend");
const fs = require("fs").promises;
const path = require("path");

// ─── Configurações ────────────────────────────────────────────────────────────

const EVENT_NAME = "Congresso Autismo MA 2026";
const CHECKOUT_STATUS = "approved";
const TEMPLATE_FILE = path.join(
  __dirname,
  "../../templates/emailCongressoMA2026.html"
);

const EMAIL_SUBJECT = "4º Congresso Salud de Autismo — Inscrições Abertas!";

// Preencha antes de rodar:
const LINKS_REDES_SOCIAIS = "https://www.instagram.com/congressoautismoma/";
const LINK_INSCRICAO = "https://congressoautismoma.com.br/checkout";

const DELAY_MS = 300;
const BATCH_LOG_EVERY = 50;

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const MAX_SEND =
  LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;

// ─── Resend ───────────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function shouldSkipCheckout(checkout) {
  const obs = (checkout.observation || "").toLowerCase().trim();
  return obs === "vivian";
}

async function getEmailStats() {
  const today = new Date().toISOString().split("T")[0];
  const ref = db.collection("emailStats").doc(today);
  const snap = await ref.get();
  const totalSent = snap.exists ? snap.data().totalSent || 0 : 0;
  const DAILY_LIMIT = 3000;
  return { totalSent, available: DAILY_LIMIT - totalSent };
}

async function incrementEmailCount(count = 1) {
  if (DRY_RUN) return;
  const today = new Date().toISOString().split("T")[0];
  const ref = db.collection("emailStats").doc(today);
  await ref.set(
    {
      totalSent: admin.firestore.FieldValue.increment(count),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

function buildHtml(template, participantName) {
  return template
    .replace(/{{nome}}/g, participantName || "Participante")
    .replace(/{{links_redes_sociais}}/g, LINKS_REDES_SOCIAIS)
    .replace(/{{link_inscricao}}/g, LINK_INSCRICAO);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Envio em massa — 4º Congresso Salud de Autismo 2026");
  console.log("=".repeat(60));

  if (DRY_RUN)
    console.log("⚠️  DRY-RUN ativado — nenhum e-mail será enviado\n");
  if (MAX_SEND !== Infinity) console.log(`⚠️  Limite de ${MAX_SEND} envios\n`);

  // 1. Verificar cota diária
  const stats = await getEmailStats();
  console.log(
    `📊 Cota diária: ${stats.totalSent} enviados, ${stats.available} disponíveis\n`
  );
  if (stats.available <= 0) {
    console.error("❌ Limite diário atingido. Tente amanhã.");
    process.exit(1);
  }

  // 2. Carregar template
  let baseHtml;
  try {
    baseHtml = await fs.readFile(TEMPLATE_FILE, "utf-8");
    console.log(`✅ Template carregado: ${TEMPLATE_FILE}`);
  } catch (err) {
    console.error(`❌ Erro ao carregar template: ${err.message}`);
    process.exit(1);
  }

  // 3. Buscar checkouts aprovados do evento
  console.log(
    `\n🔍 Buscando checkouts — evento: "${EVENT_NAME}", status: "${CHECKOUT_STATUS}"`
  );
  const snapshot = await db
    .collection("checkouts")
    .where("eventName", "==", EVENT_NAME)
    .where("status", "==", CHECKOUT_STATUS)
    .get();

  if (snapshot.empty) {
    console.log("⚠️  Nenhum checkout encontrado. Verifique os filtros.");
    process.exit(0);
  }

  const checkouts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`📦 Total de checkouts encontrados: ${checkouts.length}`);

  // 4. Para cada checkout, buscar participantes via subcoleção
  console.log(`\n📂 Buscando participantes nas subcoleções...`);

  const recipients = [];
  let skippedCheckouts = 0;

  for (const checkout of checkouts) {
    if (shouldSkipCheckout(checkout)) {
      skippedCheckouts++;
      console.log(
        `   ⏭  Checkout ${checkout.id} ignorado (observation=vivian)`
      );
      continue;
    }

    const participantsSnap = await db
      .collection("checkouts")
      .doc(checkout.id)
      .collection("participants")
      .get();

    if (participantsSnap.empty) {
      console.log(
        `   ⚠️  Checkout ${checkout.id} sem participantes na subcoleção`
      );
      continue;
    }

    for (const pDoc of participantsSnap.docs) {
      const participant = { id: pDoc.id, ...pDoc.data() };
      if (!participant.email) continue;
      recipients.push({ checkout, participant });
    }
  }

  console.log(`\n📋 Checkouts ignorados (vivian): ${skippedCheckouts}`);
  console.log(`👥 Participantes encontrados: ${recipients.length}`);

  if (recipients.length === 0) {
    console.log("⚠️  Nenhum destinatário após filtros.");
    process.exit(0);
  }

  const totalToSend = Math.min(recipients.length, MAX_SEND);

  if (totalToSend > stats.available) {
    console.error(
      `❌ Destinatários (${totalToSend}) excedem cota disponível (${stats.available}). ` +
        `Use --limit ${stats.available} ou aguarde amanhã.`
    );
    process.exit(1);
  }

  // 5. Confirmação antes de enviar
  console.log(`\n🚀 Pronto para enviar ${totalToSend} e-mails.`);
  if (!DRY_RUN) {
    console.log("   Pressione Ctrl+C nos próximos 5s para cancelar...");
    await delay(5000);
  }

  // 6. Envio
  const results = { sent: 0, skipped: 0, errors: [] };

  for (let i = 0; i < recipients.length; i++) {
    if (results.sent >= MAX_SEND) {
      console.log(`\n⛔ Limite de --limit (${MAX_SEND}) atingido.`);
      break;
    }

    const { checkout, participant } = recipients[i];
    const html = buildHtml(baseHtml, participant.name);

    if (DRY_RUN) {
      console.log(
        `   [DRY-RUN] ${i + 1}/${totalToSend} → ${participant.email} (${
          participant.name || "sem nome"
        })`
      );
      results.sent++;
      continue;
    }

    try {
      const result = await resend.emails.send({
        from: FROM_ADDRESS,
        to: [participant.email],
        subject: EMAIL_SUBJECT,
        html,
      });

      if (result.error) throw new Error(result.error.message);

      await incrementEmailCount(1);
      results.sent++;

      if (results.sent % BATCH_LOG_EVERY === 0 || i === totalToSend - 1) {
        console.log(
          `   ✉️  ${results.sent}/${totalToSend} enviados — último: ${participant.email}`
        );
      }
    } catch (err) {
      console.error(`   ❌ Erro para ${participant.email}: ${err.message}`);
      results.errors.push({
        email: participant.email,
        name: participant.name,
        checkoutId: checkout.id,
        error: err.message,
      });
    }

    await delay(DELAY_MS);
  }

  // 7. Relatório final
  console.log("\n" + "=".repeat(60));
  console.log("  Relatório final");
  console.log("=".repeat(60));
  console.log(`  ✅ Enviados:  ${results.sent}`);
  console.log(`  ⏭  Pulados:   ${results.skipped}`);
  console.log(`  ❌ Erros:     ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log("\n  Detalhes dos erros:");
    results.errors.forEach((e) =>
      console.log(
        `    - ${e.name} <${e.email}> (checkout ${e.checkoutId}): ${e.error}`
      )
    );
  }

  console.log("\n✔  Concluído!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
