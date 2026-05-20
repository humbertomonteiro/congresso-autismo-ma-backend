const CertificateService = require("../services/CertificateService");
const CheckoutRepository = require("../repositories/CheckoutRepository");

class CertificateController {
  async generateCertificate(req, res) {
    try {
      //templateHTML: cientifica, monitoria, organizadora
      const { cpf, name, templateHTML, eventName } = req.body;

      // Chama o service para gerar o PDF
      const { buffer, fileName } = await CertificateService.generateCertificate(
        cpf,
        name,
        templateHTML,
        eventName
      );

      // Configura os cabeçalhos da resposta
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${fileName}`,
        "Content-Length": buffer.length,
      });

      // Envia o PDF
      res.send(buffer);
    } catch (error) {
      console.error("Erro no CertificateController:", error);
      res
        .status(500)
        .json({ error: error.message || "Erro ao gerar o certificado." });
    }
  }

  async saveCertificateRecord(req, res) {
    try {
      const {
        providedCpf, registeredCpf, name,
        checkoutId, checkoutData, certificateType,
        participantId, eventName,
      } = req.body;

      if (!checkoutId) return res.status(400).json({ error: "checkoutId obrigatório" });
      if (!registeredCpf) return res.status(400).json({ error: "registeredCpf obrigatório" });

      const { db, admin } = require("../config").firebase;
      const checkoutRepo = CheckoutRepository;
      const now = new Date().toISOString();
      const cleanProvidedCpf = (providedCpf || "").replace(/\D/g, "") || (registeredCpf || "").replace(/\D/g, "");
      const cleanRegisteredCpf = (registeredCpf || "").replace(/\D/g, "");

      if (participantId) {
        const participantData = await checkoutRepo.getParticipantById(checkoutId, participantId);
        const currentName = participantData?.name || null;

        const updateData = {
          name,
          certificateIssued: true,
          certificateIssuedAt: now,
          certificateIssuedNames: admin.firestore.FieldValue.arrayUnion({
            name, cpf: cleanProvidedCpf, timestamp: now,
          }),
        };
        if (currentName && currentName !== name) {
          updateData.nameHistory = admin.firestore.FieldValue.arrayUnion({
            oldName: currentName, newName: name, updatedAt: now, source: "certificate",
          });
        }
        await checkoutRepo.updateParticipant(checkoutId, participantId, updateData);
      } else if (checkoutData?.participants && Array.isArray(checkoutData.participants)) {
        const updatedParticipants = checkoutData.participants.map((p) => {
          const pCpf = (p.cpf || p.document || "").replace(/\D/g, "");
          if (pCpf !== cleanRegisteredCpf) return p;
          const nameHistory = Array.isArray(p.nameHistory) ? [...p.nameHistory] : [];
          if (p.name && p.name !== name) {
            nameHistory.push({ oldName: p.name, newName: name, updatedAt: now, source: "certificate" });
          }
          const certificateIssuedNames = Array.isArray(p.certificateIssuedNames)
            ? [...p.certificateIssuedNames, { name, cpf: cleanProvidedCpf, timestamp: now }]
            : [{ name, cpf: cleanProvidedCpf, timestamp: now }];
          return { ...p, name, nameHistory, certificateIssued: true, certificateIssuedAt: now, certificateIssuedNames };
        });
        await db.collection("checkouts").doc(checkoutId).update({ participants: updatedParticipants });
      }

      await db.collection("certificates").doc(cleanRegisteredCpf).set(
        { name, providedCpf: cleanProvidedCpf, generatedAt: now, emittedOnDashboard: false },
        { merge: true }
      );

      res.json({ success: true });
    } catch (err) {
      console.error("[CertificateController] saveCertificateRecord:", err);
      res.status(500).json({ error: err.message || "Erro ao registrar certificado" });
    }
  }
}

module.exports = new CertificateController();
