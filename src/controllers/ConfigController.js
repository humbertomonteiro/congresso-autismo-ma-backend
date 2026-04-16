const { db, admin } = require("../config").firebase;
const logger = require("../logger");

const CONFIG_DOC = db.doc("config/eventConfig");
const AUDIT_COL = db.collection("eventConfigAudit");

// ── Validação ──────────────────────────────────────────────────────────────────
function validateEventConfig({ eventName, eventDates, ticketPrices, ticketBatches }) {
  const errors = [];

  if (!eventName || !eventName.trim()) {
    errors.push("eventName é obrigatório.");
  } else if (eventName.trim().length > 120) {
    errors.push("eventName deve ter no máximo 120 caracteres.");
  }

  if (!Array.isArray(eventDates) || eventDates.length === 0) {
    errors.push("eventDates deve ser um array com pelo menos uma data.");
  } else if (eventDates.length > 14) {
    errors.push("eventDates pode ter no máximo 14 datas.");
  } else {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    eventDates.forEach((d, i) => {
      if (typeof d !== "string" || !dateRe.test(d)) {
        errors.push(
          `eventDates[${i}] "${d}" não é válida (formato YYYY-MM-DD).`
        );
      } else {
        const ts = Date.parse(d);
        if (isNaN(ts))
          errors.push(`eventDates[${i}] "${d}" não é uma data real.`);
      }
    });
  }

  if (ticketPrices !== undefined) {
    const priceFields = {
      full: "inteira",
      half: "meia entrada",
      social: "social",
    };
    for (const [key, label] of Object.entries(priceFields)) {
      const raw = (ticketPrices || {})[key];
      if (raw !== undefined) {
        const v = parseFloat(raw);
        if (isNaN(v) || v < 0 || v > 99999.99)
          errors.push(
            `ticketPrices.${key} (${label}) deve ser um número entre 0 e 99999.99.`
          );
      }
    }
  }

  if (ticketBatches !== undefined) {
    for (const key of ["full", "half", "social"]) {
      const batch = (ticketBatches || {})[key];
      if (batch !== undefined) {
        if (batch.label !== undefined && typeof batch.label !== "string")
          errors.push(`ticketBatches.${key}.label deve ser uma string.`);
        if (batch.label !== undefined && batch.label.length > 60)
          errors.push(`ticketBatches.${key}.label deve ter no máximo 60 caracteres.`);
        if (batch.availableUntil !== undefined && typeof batch.availableUntil !== "string")
          errors.push(`ticketBatches.${key}.availableUntil deve ser uma string.`);
        if (batch.availableUntil !== undefined && batch.availableUntil.length > 80)
          errors.push(`ticketBatches.${key}.availableUntil deve ter no máximo 80 caracteres.`);
      }
    }
  }

  return errors;
}

// ── GET /api/config/event ──────────────────────────────────────────────────────
const getEventConfig = async (req, res) => {
  try {
    const snap = await CONFIG_DOC.get();
    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        message: "Configuração do evento não encontrada. Crie uma primeiro.",
      });
    }
    res.json({ success: true, data: snap.data() });
  } catch (err) {
    logger.error("[ConfigController] Erro ao buscar config:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/config/event (requer verifyToken + requireAdm) ──────────────────
const updateEventConfig = async (req, res) => {
  try {
    const { eventName, eventDates, ticketPrices, ticketBatches } = req.body;

    const errors = validateEventConfig({ eventName, eventDates, ticketPrices, ticketBatches });
    if (errors.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: errors.join(" ") });
    }

    // Lê estado anterior para audit
    const beforeSnap = await CONFIG_DOC.get();
    const before = beforeSnap.exists ? beforeSnap.data() : null;

    const newConfig = {
      eventName: eventName.trim(),
      eventDates: [...new Set(eventDates.map((d) => d.trim()))].sort(),
      ticketPrices: {
        full: parseFloat(parseFloat(ticketPrices?.full ?? 499.9).toFixed(2)),
        half: parseFloat(parseFloat(ticketPrices?.half ?? 399.9).toFixed(2)),
        social: parseFloat(
          parseFloat(ticketPrices?.social ?? 199.9).toFixed(2)
        ),
      },
      ticketBatches: {
        full:   { label: (ticketBatches?.full?.label   ?? "2° Lote").trim(), availableUntil: (ticketBatches?.full?.availableUntil   ?? "").trim() },
        half:   { label: (ticketBatches?.half?.label   ?? "2° Lote").trim(), availableUntil: (ticketBatches?.half?.availableUntil   ?? "").trim() },
        social: { label: (ticketBatches?.social?.label ?? "2° Lote").trim(), availableUntil: (ticketBatches?.social?.availableUntil ?? "").trim() },
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email || req.user.uid,
    };

    // Grava config
    await CONFIG_DOC.set(newConfig, { merge: false });

    // Audit log (sem await bloqueante — não falha a requisição se o log falhar)
    AUDIT_COL.add({
      before,
      after: { ...newConfig, updatedAt: new Date().toISOString() },
      changedBy: req.user.email || req.user.uid,
      changedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch((e) =>
      logger.warn("[ConfigController] Falha ao gravar audit:", e.message)
    );

    logger.info(
      `[ConfigController] Config atualizada por ${
        req.user.email || req.user.uid
      }`
    );
    res.json({
      success: true,
      message: "Configuração atualizada com sucesso.",
      data: newConfig,
    });
  } catch (err) {
    logger.error("[ConfigController] Erro ao atualizar config:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/config/event/audit (últimas alterações) ──────────────────────────
const getAuditLog = async (req, res) => {
  try {
    const snap = await AUDIT_COL.orderBy("changedAt", "desc").limit(20).get();
    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, data: entries });
  } catch (err) {
    logger.error("[ConfigController] Erro ao buscar audit:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getEventConfig, updateEventConfig, getAuditLog };
