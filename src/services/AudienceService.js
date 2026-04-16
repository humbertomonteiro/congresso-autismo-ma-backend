const { db, admin } = require("../config").firebase;
const logger = require("../logger");

// ─── Filtros suportados numa audiência ────────────────────────────────────
//
// Nível de CHECKOUT:
//   checkoutStatus      : "approved" | "pending" | "error" | "expired"
//   paymentMethod       : "creditCard" | "boleto" | "pix"
//   excludeCourtesy     : true  → exclui isCourtesy === true
//   coupon              : null = qualquer cupom (sem filtro)
//                          ""  = só sem cupom
//                          "X" = só quem usou cupom X
//   notes               : string → checkout.notes contains (case-insensitive)
//
// Nível de PARTICIPANTE:
//   ticketType          : "full" | "half"
//   participantEmailSent: true  → só quem JÁ recebeu e-mail (emailSent === true)
//                          false → só quem AINDA NÃO recebeu e-mail
//   participantCheckedIn: true  → só quem JÁ fez check-in
//                          false → só quem AINDA NÃO fez check-in
//   participantCheckedInDate: "2026-05-16" → só quem fez check-in nessa data
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
    // ── Filtros de checkout ──────────────────────────────────────────────
    if (filters.checkoutStatus && checkout.status !== filters.checkoutStatus) {
      return false;
    }

    if (filters.eventName && checkout.eventName !== filters.eventName) {
      return false;
    }

    if (
      filters.paymentMethod &&
      checkout.paymentMethod !== filters.paymentMethod
    ) {
      return false;
    }

    if (filters.excludeCourtesy && checkout.isCourtesy === true) {
      return false;
    }

    // coupon: null = não filtra, "" = sem cupom, "X" = cupom específico
    if (filters.coupon !== undefined && filters.coupon !== null) {
      const checkoutCoupon = checkout.orderDetails?.coupon || "";
      if (filters.coupon !== checkoutCoupon) return false;
    }

    if (filters.notes) {
      const checkoutNotes = (checkout.notes || "").toLowerCase();
      if (!checkoutNotes.includes(filters.notes.toLowerCase())) return false;
    }

    // ── Filtros de participante ──────────────────────────────────────────
    if (filters.ticketType && participant.ticketType !== filters.ticketType) {
      return false;
    }

    // participantEmailSent: true → só quem JÁ recebeu; false → só quem NÃO recebeu
    if (
      filters.participantEmailSent !== undefined &&
      filters.participantEmailSent !== null
    ) {
      const emailSent = participant.emailSent === true;
      if (filters.participantEmailSent !== emailSent) return false;
    }

    // participantCheckedIn: true → só quem JÁ fez check-in; false → quem NÃO fez
    if (
      filters.participantCheckedIn !== undefined &&
      filters.participantCheckedIn !== null
    ) {
      const checkedIn = participant.checkedIn === true;
      if (filters.participantCheckedIn !== checkedIn) return false;
    }

    // participantCheckedInDate: verifica se fez check-in nessa data específica
    if (filters.participantCheckedInDate) {
      const checkedInDates = participant.checkedInDates || {};
      if (!checkedInDates[filters.participantCheckedInDate]) return false;
    }

    return true;
  }

  // ── Constrói query de participantes com filtros possíveis no Firestore ────
  _buildParticipantQuery(checkoutRef, filters) {
    let q = checkoutRef.collection("participants");

    if (filters.ticketType) {
      q = q.where("ticketType", "==", filters.ticketType);
    }

    // emailSent pode ser consultado direto no Firestore
    if (
      filters.participantEmailSent !== undefined &&
      filters.participantEmailSent !== null
    ) {
      q = q.where("emailSent", "==", filters.participantEmailSent === true);
    }

    // checkedIn pode ser consultado direto no Firestore
    if (
      filters.participantCheckedIn !== undefined &&
      filters.participantCheckedIn !== null
    ) {
      q = q.where("checkedIn", "==", filters.participantCheckedIn === true);
    }

    return q;
  }

  // ── Retorna o tamanho estimado de uma audiência ───────────────────────────
  async estimateAudienceSize(audienceId) {
    const audience = await this.getAudienceById(audienceId);
    return this.estimateWithFilters(audience.filters);
  }

  // Estimativa por filtros (sem precisar de audiência salva — usado no form)
  async estimateWithFilters(filters = {}) {
    // Busca checkouts com filtros que o Firestore suporta nativamente
    let query = db.collection("checkouts");
    if (filters.checkoutStatus) {
      query = query.where("status", "==", filters.checkoutStatus);
    }
    if (filters.eventName) {
      query = query.where("eventName", "==", filters.eventName);
    }
    if (filters.paymentMethod) {
      query = query.where("paymentMethod", "==", filters.paymentMethod);
    }
    const checkoutsSnap = await query.get();
    let count = 0;

    for (const checkoutDoc of checkoutsSnap.docs) {
      const checkout = { id: checkoutDoc.id, ...checkoutDoc.data() };

      // Filtros que o Firestore não resolve nativamente
      // excludeCourtesy é feito em memória pois "!= true" no Firestore exclui
      // documentos que não possuem o campo, zerando resultados incorretamente.
      if (filters.excludeCourtesy && checkout.isCourtesy === true) continue;

      if (filters.coupon !== undefined && filters.coupon !== null) {
        const checkoutCoupon = checkout.orderDetails?.coupon || "";
        if (filters.coupon !== checkoutCoupon) continue;
      }
      if (filters.notes) {
        const checkoutNotes = (checkout.notes || "").toLowerCase();
        if (!checkoutNotes.includes(filters.notes.toLowerCase())) continue;
      }

      // Busca participantes com filtros do Firestore
      const participantsQuery = this._buildParticipantQuery(
        checkoutDoc.ref,
        filters
      );
      const participantsSnap = await participantsQuery.get();

      // Filtros de participante que o Firestore não resolve (checkedInDate)
      if (filters.participantCheckedInDate) {
        for (const pDoc of participantsSnap.docs) {
          const p = pDoc.data();
          const checkedInDates = p.checkedInDates || {};
          if (checkedInDates[filters.participantCheckedInDate]) count++;
        }
      } else {
        count += participantsSnap.size;
      }
    }

    return count;
  }

  // ── Itera checkouts+participantes que pertencem a uma audiência ───────────
  // Callback recebe (checkout, participant) para cada match.
  // Útil para disparo sem precisar carregar tudo na memória.
  async forEachMatchingParticipant(audienceId, callback) {
    const audience = await this.getAudienceById(audienceId);
    const { filters } = audience;

    let query = db.collection("checkouts");
    if (filters.checkoutStatus)
      query = query.where("status", "==", filters.checkoutStatus);
    if (filters.eventName)
      query = query.where("eventName", "==", filters.eventName);
    if (filters.paymentMethod)
      query = query.where("paymentMethod", "==", filters.paymentMethod);

    const checkoutsSnap = await query.get();

    for (const checkoutDoc of checkoutsSnap.docs) {
      const checkout = { id: checkoutDoc.id, ...checkoutDoc.data() };

      if (filters.excludeCourtesy && checkout.isCourtesy === true) continue;

      if (filters.coupon !== undefined && filters.coupon !== null) {
        if ((checkout.orderDetails?.coupon || "") !== filters.coupon) continue;
      }
      if (filters.notes) {
        if (
          !(checkout.notes || "")
            .toLowerCase()
            .includes(filters.notes.toLowerCase())
        )
          continue;
      }

      const participantsQuery = this._buildParticipantQuery(
        checkoutDoc.ref,
        filters
      );
      const participantsSnap = await participantsQuery.get();

      for (const pDoc of participantsSnap.docs) {
        const participant = { id: pDoc.id, ...pDoc.data() };

        // Filtro in-memory para checkedInDate (não consultável no Firestore facilmente)
        if (filters.participantCheckedInDate) {
          const checkedInDates = participant.checkedInDates || {};
          if (!checkedInDates[filters.participantCheckedInDate]) continue;
        }

        await callback(checkout, participant);
      }
    }
  }
}

module.exports = new AudienceService();
