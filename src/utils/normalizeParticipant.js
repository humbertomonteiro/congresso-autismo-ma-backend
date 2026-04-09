const { admin } = require("../config").firebase;

function normalizeParticipant(raw, { checkoutId, ticketType = "full" } = {}) {
  if (!raw.name || !raw.name.trim()) throw new Error("Participante sem nome.");
  if (!raw.email || !raw.email.trim())
    throw new Error("Participante sem email.");
  if (!raw.document || !raw.document.trim())
    throw new Error("Participante sem documento.");

  const document = raw.document.replace(/\D/g, "");
  if (document.length !== 11 && document.length !== 14) {
    throw new Error(
      `Documento inválido para ${raw.name}: deve ser CPF (11 dígitos) ou CNPJ (14 dígitos).`
    );
  }

  return {
    name: raw.name.trim(),
    email: raw.email.trim().toLowerCase(),
    document,
    phone: (raw.phone || "").replace(/\D/g, ""),
    ticketType,
    checkoutId: checkoutId || "",
    // ✅ qrToken removido daqui — será gerado após salvar no Firestore
    checkedIn: false,
    checkedInAt: null,
    checkedInDate: null,
    emailSent: false,
    emailSentAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function buildParticipantsBatch(
  participants,
  { checkoutId, allTickets, halfTickets }
) {
  return participants.map((p, i) => {
    const ticketType =
      i < allTickets
        ? "full"
        : i < allTickets + halfTickets
        ? "half"
        : "social";
    return normalizeParticipant(p, { checkoutId, ticketType });
  });
}

module.exports = { normalizeParticipant, buildParticipantsBatch };
