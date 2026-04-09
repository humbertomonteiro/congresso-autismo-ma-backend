const { db, admin } = require("../config").firebase;
const logger = require("../logger");

// ─── Estrutura no Firestore ────────────────────────────────────────────────
//
// checkouts/{checkoutId}
//   status, paymentMethod, paymentId, buyerName, buyerEmail, buyerCpf
//   orderDetails: { fullTickets, halfTickets, total, discount, coupon, installments }
//   paymentDetails: { boleto?: {...}, pix?: {...}, creditCard?: {...} }
//   createdAt, updatedAt
//
// checkouts/{checkoutId}/participants/{participantId}
//   checkoutId, name, email, cpf, ticketType: "full"|"half"
//   qrToken (string única — usada para gerar o QR no momento da leitura)
//   checkedIn: false, checkedInAt: null
//   emailSent: false
//   createdAt
//
// ──────────────────────────────────────────────────────────────────────────

class CheckoutRepository {
  // ── Checkouts ─────────────────────────────────────────────────────────────

  async saveCheckout(checkoutData) {
    const ref = db.collection("checkouts").doc();
    await ref.set({
      ...checkoutData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  async getCheckoutById(checkoutId) {
    const snap = await db.collection("checkouts").doc(checkoutId).get();
    if (!snap.exists) throw new Error(`Checkout ${checkoutId} não encontrado`);
    return { id: snap.id, ...snap.data() };
  }

  async fetchCheckouts(filters = {}) {
    try {
      let query = db.collection("checkouts");
      for (const [key, value] of Object.entries(filters)) {
        query = query.where(key, "==", value);
      }
      const snapshot = await query.get();
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      logger.error(`[CheckoutRepository] fetchCheckouts: ${error.message}`);
      throw error;
    }
  }

  async getPendingCheckouts() {
    const snapshot = await db
      .collection("checkouts")
      .where("status", "==", "pending")
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async fetchCheckoutByTransactionId(transactionId) {
    const snapshot = await db
      .collection("checkouts")
      .where("transactionId", "==", transactionId)
      .get();
    if (snapshot.empty) {
      throw new Error(
        `Checkout com transactionId ${transactionId} não encontrado`
      );
    }
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async updateCheckout(checkoutId, data) {
    await db
      .collection("checkouts")
      .doc(checkoutId)
      .update({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    logger.info(`[CheckoutRepository] Checkout ${checkoutId} atualizado`);
  }

  async updateCheckoutStatus(checkoutId, newStatus) {
    await this.updateCheckout(checkoutId, { status: newStatus });
    logger.info(
      `[CheckoutRepository] Checkout ${checkoutId} → status: ${newStatus}`
    );
  }

  // ── Participants ──────────────────────────────────────────────────────────

  async saveParticipants(checkoutId, participants) {
    const batch = db.batch();
    const refs = [];

    for (const participant of participants) {
      const ref = db
        .collection("checkouts")
        .doc(checkoutId)
        .collection("participants")
        .doc();
      refs.push(ref.id);
      batch.set(ref, {
        ...participant,
        checkoutId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    logger.info(
      `[CheckoutRepository] ${participants.length} participante(s) salvos em ${checkoutId}`
    );
    return refs;
  }

  async getParticipantsByCheckout(checkoutId) {
    const snapshot = await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("participants")
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getParticipantById(checkoutId, participantId) {
    const snap = await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("participants")
      .doc(participantId)
      .get();
    if (!snap.exists)
      throw new Error(`Participante ${participantId} não encontrado`);
    return { id: snap.id, ...snap.data() };
  }

  async updateParticipant(checkoutId, participantId, data) {
    await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("participants")
      .doc(participantId)
      .update(data);
    logger.info(
      `[CheckoutRepository] Participante ${participantId} atualizado`
    );
  }

  // Busca participante por documento (CPF/CNPJ) dentro de um checkout
  async getParticipantByCpf(checkoutId, cpf) {
    const cleanDoc = cpf.replace(/\D/g, "");
    const snapshot = await db
      .collection("checkouts")
      .doc(checkoutId)
      .collection("participants")
      .where("document", "==", cleanDoc)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  // Busca participante por qrToken (para check-in)
  async getParticipantByQrToken(qrToken) {
    // Busca em todos os checkouts — necessário para o scanner
    const checkoutsSnap = await db.collection("checkouts").get();
    for (const checkoutDoc of checkoutsSnap.docs) {
      const snap = await checkoutDoc.ref
        .collection("participants")
        .where("qrToken", "==", qrToken)
        .get();
      if (!snap.empty) {
        const p = snap.docs[0];
        return { id: p.id, checkoutId: checkoutDoc.id, ...p.data() };
      }
    }
    return null;
  }

  // ── Migração — converte array de participants embutido para subcoleção ────

  async migrateParticipantsToSubcollection(checkoutId) {
    const checkoutRef = db.collection("checkouts").doc(checkoutId);
    const snap = await checkoutRef.get();
    if (!snap.exists) throw new Error(`Checkout ${checkoutId} não encontrado`);

    const data = snap.data();
    const participants = data.participants;

    if (!Array.isArray(participants) || participants.length === 0) {
      logger.info(
        `[Migration] Checkout ${checkoutId} não tem participants para migrar`
      );
      return 0;
    }

    const batch = db.batch();
    for (const p of participants) {
      const ref = checkoutRef.collection("participants").doc();
      batch.set(ref, {
        checkoutId,
        name: p.name || "",
        email: p.email || "",
        cpf: (p.document || p.cpf || "").replace(/\D/g, ""),
        ticketType: p.ticketType || "full",
        qrToken: p.qrRawData ? Object.values(p.qrRawData)[0] || "" : "",
        checkedIn: p.validated
          ? Object.values(p.validated).some(Boolean)
          : false,
        checkedInAt: null,
        emailSent: p.emailSent || false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        _legacy: p, // preserva dados originais para auditoria
      });
    }

    await batch.commit();
    logger.info(
      `[Migration] ${participants.length} participantes migrados do checkout ${checkoutId}`
    );
    return participants.length;
  }
}

module.exports = new CheckoutRepository();
