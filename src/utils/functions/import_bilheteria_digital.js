/**
 * Importa participantes da Bilheteria Digital para o Firestore.
 *
 * Entrada : backend/src/lista bilheteria digital.xlsx  (23 abas)
 * Saída   : checkouts/{orderCode} + subcoleção participants
 *
 * Uso:
 *   node src/utils/functions/import_bilheteria_digital.js
 */

const path = require("path");
const XLSX = require("xlsx");
const CheckoutRepository = require("../../repositories/CheckoutRepository");
const { firebase } = require("../../config");

const { db, admin } = firebase;

const XLSX_PATH = path.resolve(__dirname, "../../lista bilheteria digital.xlsx");

// ── Parsing helpers ────────────────────────────────────────────────────────

const detectTicketType = (text) => {
  const t = text.toUpperCase();
  if (t.includes("MEIA")) return "half";
  if (t.includes("SOCIAL")) return "social";
  if (t.includes("INGRESSO")) return "full";
  return null;
};

const parsePrice = (allText) => {
  const m = allText.match(/R\$\s*([\d.]+,\d{2})/);
  if (!m) return "0.00";
  return m[1].replace(/\./g, "").replace(",", ".");
};

/**
 * Parse an info-row text into { code, cpf, name, phone, nameResolved }
 * Handles all observed formats:
 *   "CODE - CPF: XXX.XXX.XXX-XX NAME\n(DDD) PHONE"
 *   "CODE - CPF: XXX.XXX.XXX-XX\nNAME\n(DDD) PHONE"
 *   "CODE - CPF: XXX.XXX.XXX-XX\n(DDD) PHONE"  (no name)
 *   "CODE - CPF: XXX.XXX.XXX-XX"               (name+phone on next row)
 */
const parseInfoText = (text) => {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const line0 = lines[0];

  const match = line0.match(/^(.+?)\s*-\s*CPF:\s*([\d./-]+)\s*(.*)/);
  if (!match) return null;

  const code = match[1].trim();
  const cpf = match[2].trim();
  let name = match[3].trim();
  let phone = "";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\(?\d{2}\)?/.test(line)) {
      phone = line;
    } else if (line) {
      name = name ? name + " " + line : line;
    }
  }

  return { code, cpf, name, phone, nameResolved: !!phone };
};

/**
 * Merge name/phone continuation into a partially-parsed participant
 * (when info row had only code+CPF, with name+phone on the next row)
 */
const applyContinuation = (current, text) => {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^\(?\d{2}\)?/.test(line)) {
      current.phone = line;
      current.nameResolved = true;
    } else if (line) {
      current.name = current.name ? current.name + " " + line : line;
    }
  }
};

// ── Process all sheets as a continuous stream ──────────────────────────────
// Sheets break mid-participant (page breaks in PDF), so state carries over.

const processAllSheets = (wb) => {
  const participants = [];
  let current = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    for (const rawRow of rows) {
      const cols = rawRow.map((v) => String(v || "").trim());
      if (cols.every((v) => !v)) continue;

      const allText = cols.join(" ");

      // ── Ticket row ──────────────────────────────────────────────────
      if (allText.includes("INGRESSO")) {
        if (!current) continue; // truly orphan with no preceding info row

        const typeText = cols.find((c) => c.includes("INGRESSO")) || allText;
        current.ticketType = detectTicketType(typeText);
        current.totalAmount = parsePrice(allText);

        // Qty: standalone number (1–99) in any column
        const qtyCol = cols.find(
          (c) => /^\d+$/.test(c) && Number(c) > 0 && Number(c) < 100
        );
        current.qty = qtyCol ? parseInt(qtyCol, 10) : 1;

        // "Transferido" note embedded in ticket text
        const transferMatch = allText.match(/Transferido do pedido (\d+)/);
        if (transferMatch) {
          current.observation =
            `Importado da Bilheteria Digital | Transferido do pedido ${transferMatch[1]}`;
        }
        continue;
      }

      // ── "Transferido" standalone row ────────────────────────────────
      if (cols[0].startsWith("Transferido do pedido")) {
        if (current) {
          current.observation = `Importado da Bilheteria Digital | ${cols[0]}`;
        }
        continue;
      }

      // ── Info row (has " - CPF:") ─────────────────────────────────────
      if (allText.includes(" - CPF:")) {
        if (current) participants.push(current);

        const infoText = cols.find((c) => c.includes(" - CPF:")) || allText;
        const parsed = parseInfoText(infoText);
        if (!parsed) continue;

        current = {
          ...parsed,
          ticketType: null,
          totalAmount: "0.00",
          qty: 1,
          observation: "Importado da Bilheteria Digital",
        };
        continue;
      }

      // ── Continuation row ────────────────────────────────────────────
      if (current && !current.nameResolved && cols[0]) {
        applyContinuation(current, cols[0]);
      }
    }
  }

  if (current) participants.push(current);
  return participants;
};

// ── Firestore write ────────────────────────────────────────────────────────

const writeCheckout = async (p) => {
  const ticketType = p.ticketType || "full";
  const qty = p.qty || 1;

  const orderDetails = {
    allTickets: ticketType === "full" ? qty : 0,
    halfTickets: ticketType === "half" ? qty : 0,
    socialTickets: ticketType === "social" ? qty : 0,
    total: qty,
  };

  const checkoutRef = db.collection("checkouts").doc(p.code);
  await checkoutRef.set({
    status: "approved",
    eventName: "Congresso Autismo MA 2026",
    paymentMethod: "bilheteria-digital",
    isExternal: true,
    externalOrderCode: p.code,
    observation: p.observation,
    totalAmount: p.totalAmount,
    orderDetails,
    sentEmails: [],
    isCourtesy: false,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Build participants list
  const participantsList = [
    {
      name: p.name || "",
      phone: p.phone || "",
      document: (p.cpf || "").replace(/\D/g, ""), // digits only — matches the search in /ingressos
      email: "",
      ticketType,
      emailSent: false,
      checkedIn: false,
      checkedInAt: null,
      active: true,
      status: "active",
    },
  ];

  for (let i = 2; i <= qty; i++) {
    participantsList.push({
      name: `Participante ${i}`,
      phone: "",
      document: "",
      email: "",
      ticketType,
      emailSent: false,
      checkedIn: false,
      checkedInAt: null,
      active: true,
      status: "active",
    });
  }

  await CheckoutRepository.saveParticipants(p.code, participantsList);

  return participantsList.length;
};

// ── Main ───────────────────────────────────────────────────────────────────

const run = async () => {
  console.log(`Lendo arquivo: ${XLSX_PATH}\n`);
  const wb = XLSX.readFile(XLSX_PATH);
  const allParticipants = processAllSheets(wb);

  console.log(`${allParticipants.length} participante(s) encontrado(s)\n`);
  console.log("Importando...");

  const noTicket = allParticipants.filter((p) => !p.ticketType);
  if (noTicket.length > 0) {
    console.log(
      `⚠  ${noTicket.length} participante(s) sem tipo de ingresso na planilha (serão importados como "inteira" — corrigir manualmente):`
    );
    noTicket.forEach((p) =>
      console.log(`   • ${p.code} — ${p.name || "(sem nome)"}`)
    );
    console.log();
  }

  let checkoutsCreated = 0;
  let totalParticipants = 0;
  let errors = 0;

  for (const p of allParticipants) {
    const label = `${p.code} — ${p.name || "(sem nome)"} (${p.qty}x ${p.ticketType || "full"})`;
    try {
      const count = await writeCheckout(p);
      console.log(`  ✓ ${label}`);
      checkoutsCreated++;
      totalParticipants += count;
    } catch (err) {
      console.error(`  ✗ ${label}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n─── Resultado ───────────────────────────`);
  console.log(`Checkouts criados : ${checkoutsCreated}`);
  console.log(`Participantes     : ${totalParticipants}`);
  console.log(`Erros             : ${errors}`);
  if (noTicket.length > 0) {
    console.log(`\n⚠  ${noTicket.length} checkout(s) com tipo "inteira" por padrão — verificar no dashboard.`);
  }
};

run().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
