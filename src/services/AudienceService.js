const { db, admin } = require("../config").firebase;
const logger = require("../logger");

// ─── Filtros suportados numa audiência ────────────────────────────────────
//
// checkoutStatus    : "approved" | "pending" | "error" | "expired"
// paymentMethod     : "creditCard" | "boleto" | "pix"
// excludeCourtesy   : true  → exclui checkouts onde isCourtesy === true
// ticketType        : "full" | "half"  → filtra por tipo de ingresso do participante
// coupon            : string | null    → null = qualquer cupom (incluindo sem cupom)
//                                        "" = sem cupom
//                                        "grupo" = só quem usou esse cupom
// notes             : string           → filtra por campo "notes" do checkout (observação)
//
// ─────────────────────────────────────────────────────────────────────────

class AudienceService {
  // ── CRUD de audiências ────────────────────────────────────────────────────

  async createAudience({ name, description = "", filters = {} }) {
    if (!name) throw new Error("Nome da audiência é obrigatório.");
    const ref = await db.collection("emailAudiences").add({
      name,
      description,
      filters,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info(`[AudienceService] Audiência criada: ${ref.id}`);
    return ref.id;
  }

  async getAllAudiences() {
    const snap = await db
      .collection("emailAudiences")
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getAudienceById(audienceId) {
    const snap = await db.collection("emailAudiences").doc(audienceId).get();
    if (!snap.exists)
      throw new Error(`Audiência ${audienceId} não encontrada.`);
    return { id: snap.id, ...snap.data() };
  }

  async updateAudience(audienceId, data) {
    await db
      .collection("emailAudiences")
      .doc(audienceId)
      .update({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    logger.info(`[AudienceService] Audiência ${audienceId} atualizada`);
  }

  async deleteAudience(audienceId) {
    await db.collection("emailAudiences").doc(audienceId).delete();
    logger.info(`[AudienceService] Audiência ${audienceId} deletada`);
  }

  // ── Avalia se um checkout+participante pertence a uma audiência ───────────

  participantMatchesAudience(checkout, participant, filters) {
    // Filtro por status do checkout
    if (filters.checkoutStatus && checkout.status !== filters.checkoutStatus) {
      return false;
    }

    // Filtro por método de pagamento
    if (
      filters.paymentMethod &&
      checkout.paymentMethod !== filters.paymentMethod
    ) {
      return false;
    }

    // Excluir cortesia
    if (filters.excludeCourtesy && checkout.isCourtesy === true) {
      return false;
    }

    // Filtro por tipo de ingresso do participante
    if (filters.ticketType && participant.ticketType !== filters.ticketType) {
      return false;
    }

    // Filtro por cupom
    // null = não filtra por cupom
    // "" = só quem NÃO usou cupom
    // "grupo" = só quem usou esse cupom específico
    if (filters.coupon !== undefined && filters.coupon !== null) {
      const checkoutCoupon = checkout.orderDetails?.coupon || "";
      if (filters.coupon !== checkoutCoupon) return false;
    }

    // Filtro por observação (notes) do checkout
    if (filters.notes) {
      const checkoutNotes = (checkout.notes || "").toLowerCase();
      if (!checkoutNotes.includes(filters.notes.toLowerCase())) return false;
    }

    return true;
  }

  // Retorna o tamanho estimado de uma audiência (conta participantes que se encaixam)
  async estimateAudienceSize(audienceId) {
    const audience = await this.getAudienceById(audienceId);
    const { filters } = audience;

    // Busca checkouts com filtros básicos que o Firestore suporta
    let query = db.collection("checkouts");
    if (filters.checkoutStatus) {
      query = query.where("status", "==", filters.checkoutStatus);
    }
    if (filters.paymentMethod) {
      query = query.where("paymentMethod", "==", filters.paymentMethod);
    }
    if (filters.excludeCourtesy) {
      query = query.where("isCourtesy", "!=", true);
    }

    const checkoutsSnap = await query.get();
    let count = 0;

    for (const checkoutDoc of checkoutsSnap.docs) {
      const checkout = { id: checkoutDoc.id, ...checkoutDoc.data() };

      // Filtra o que o Firestore não consegue (coupon, notes, etc.)
      if (filters.coupon !== undefined && filters.coupon !== null) {
        const checkoutCoupon = checkout.orderDetails?.coupon || "";
        if (filters.coupon !== checkoutCoupon) continue;
      }
      if (filters.notes) {
        const checkoutNotes = (checkout.notes || "").toLowerCase();
        if (!checkoutNotes.includes(filters.notes.toLowerCase())) continue;
      }

      // Conta participantes com filtro de ticketType
      if (filters.ticketType) {
        const participantsSnap = await checkoutDoc.ref
          .collection("participants")
          .where("ticketType", "==", filters.ticketType)
          .get();
        count += participantsSnap.size;
      } else {
        const participantsSnap = await checkoutDoc.ref
          .collection("participants")
          .get();
        count += participantsSnap.size;
      }
    }

    return count;
  }
}

module.exports = new AudienceService();
