const config = require("../config");
const {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  doc,
  updateDoc,
  arrayRemove,
  arrayUnion,
} = require("firebase/firestore");
const logger = require("../logger");

const db = config.firebase.db;

class CheckoutRepository {
  async saveCheckout(checkoutData) {
    const docRef = await addDoc(collection(db, "checkouts"), checkoutData);
    return docRef.id;
  }

  async fetchCheckouts(filters = {}) {
    try {
      let q = query(collection(db, "checkouts"));
      for (const [key, value] of Object.entries(filters)) {
        q = query(q, where(key, "==", value));
      }
      const snapshot = await getDocs(q);
      const checkouts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      // logger.info(
      //   `Fetched ${checkouts.length} checkouts with filters: ${JSON.stringify(
      //     filters
      //   )}`
      // );
      return checkouts;
    } catch (error) {
      logger.error(`[Error fetching checkouts]: ${error.message}`);
      throw error;
    }
  }

  async fetchCheckoutsNeedingTemplate(templateId) {
    try {
      const q = query(
        collection(db, "checkouts"),
        where("pendingEmails", "array-contains", templateId)
      );
      const snapshot = await getDocs(q);
      const checkouts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      logger.info(
        `Fetched ${checkouts.length} checkouts needing template ${templateId}`
      );
      return checkouts;
    } catch (error) {
      logger.error(
        `Error fetching checkouts needing template ${templateId}: ${error.message}`
      );
      throw error;
    }
  }

  async fetchCheckoutByTransactionId(transactionId) {
    try {
      const q = query(
        collection(db, "checkouts"),
        where("transactionId", "==", transactionId)
      );
      const snapshot = await getDocs(q);
      const checkouts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      if (checkouts.length === 0) {
        throw new Error(
          `Checkout com transactionId ${transactionId} não encontrado`
        );
      }
      const checkout = checkouts[0];
      logger.info(`Fetched checkout with transactionId: ${transactionId}`);
      return checkout;
    } catch (error) {
      logger.error(
        `Error fetching checkout by transactionId ${transactionId}: ${error.message}`
      );
      throw error;
    }
  }

  async updateParticipant(checkoutId, participantIndex, data) {
    try {
      const checkoutRef = doc(db, "checkouts", checkoutId);
      const checkoutSnap = await getDoc(checkoutRef);
      if (!checkoutSnap.exists()) {
        throw new Error(`Checkout ${checkoutId} não encontrado`);
      }
      const checkoutData = checkoutSnap.data();
      checkoutData.participants[participantIndex] = {
        ...checkoutData.participants[participantIndex],
        ...data,
      };
      await updateDoc(checkoutRef, { participants: checkoutData.participants });
      logger.info(
        `Updated participant ${participantIndex} in checkout ${checkoutId}`
      );
    } catch (error) {
      logger.error(
        `Error updating participant ${participantIndex} in checkout ${checkoutId}: ${error.message}`
      );
      throw error;
    }
  }

  async getPendingCheckouts() {
    const checkoutsRef = collection(db, "checkouts");
    const q = query(checkoutsRef, where("status", "==", "pending"));
    const querySnapshot = await getDocs(q);
    const checkouts = [];
    querySnapshot.forEach((doc) => {
      checkouts.push({ id: doc.id, ...doc.data() });
    });
    return checkouts;
  }

  async updateCheckoutStatus(
    checkoutId,
    newStatus,
    sendEmailConfirmationPayment = null
  ) {
    const checkoutRef = doc(db, "checkouts", checkoutId);
    await updateDoc(checkoutRef, { status: newStatus });

    if (newStatus === "approved" && sendEmailConfirmationPayment) {
      const checkoutSnap = await getDoc(checkoutRef);
      if (!checkoutSnap.exists()) {
        console.error(`Checkout ${checkoutId} não encontrado.`);
        return;
      }
      const checkoutData = checkoutSnap.data();

      const emailResponses = [];
      for (const participant of checkoutData.participants || []) {
        console.log(`[DEBUG] Enviando e-mail para: ${participant.email}`);
        const emailData = {
          checkoutId: checkoutId,
          from: process.env.EMAIL_USER_1,
          to: participant.email,
          subject: "Confirmação de Pagamento - Congresso Autismo MA 2026",
          data: {
            name: participant.name || "Participante",
            transactionId: checkoutData.transactionId || "N/A",
            fullTickets:
              checkoutData.fullTickets ||
              checkoutData.orderDetails?.fullTickets ||
              0,
            valueTicketsAll:
              checkoutData.valueTicketsAll ||
              checkoutData.orderDetails?.fullTicketsValue ||
              "0.00",
            halfTickets:
              checkoutData.halfTickets ||
              checkoutData.orderDetails?.halfTickets ||
              0,
            valueTicketsHalf:
              checkoutData.valueTicketsHalf ||
              checkoutData.orderDetails?.halfTicketsValue ||
              "0.00",
            total: checkoutData.total || checkoutData.totalAmount || "0.00",
            coupon:
              checkoutData.coupon || checkoutData.orderDetails?.coupon || "",
            discount:
              checkoutData.discount ||
              checkoutData.orderDetails?.discount ||
              "0.00",
            installments:
              checkoutData.installments ||
              checkoutData.paymentDetails?.creditCard?.installments ||
              1,
          },
        };

        console.log(
          "Enviando email de confirmação para:",
          participant.email,
          "com:",
          emailData
        );
        try {
          const emailResponse = await sendEmailConfirmationPayment(emailData);
          console.log(
            "Email enviado com sucesso para:",
            participant.email,
            "Resposta:",
            emailResponse
          );
          emailResponses.push(emailResponse);
        } catch (error) {
          console.error(
            "Erro ao enviar email de confirmação para:",
            participant.email,
            ":",
            error.message
          );
        }
      }
    }
  }

  async saveCieloSales(sales) {
    for (const sale of sales) {
      const checkoutData = {
        transactionId: sale.Payment.PaymentId,
        status:
          sale.Payment.Status === 1 || sale.Payment.Status === 2
            ? "approved"
            : "pending",
        paymentMethod: sale.Payment.Type,
        totalAmount: (sale.Payment.Amount / 100).toFixed(2),
        participants: [
          { email: "cliente@exemplo.com", name: "Cliente Exemplo" },
        ],
        orderDetails: {
          fullTickets: 1,
          halfTickets: 0,
          fullTicketsValue: (sale.Payment.Amount / 100).toFixed(2),
          halfTicketsValue: "0.00",
          discount: "0.00",
        },
        timestamp: new Date().toISOString(),
      };
      await addDoc(collection(db, "checkouts"), checkoutData);
    }
  }

  async updateCheckout(checkoutId, data) {
    try {
      const checkoutRef = doc(db, "checkouts", checkoutId);
      await updateDoc(checkoutRef, data);
      logger.info(
        `Updated checkout ${checkoutId} with: ${JSON.stringify(data)}`
      );
    } catch (error) {
      logger.error(`Error updating checkout ${checkoutId}: ${error.message}`);
      throw error;
    }
  }

  // Método auxiliar pra buscar templates ativos por status
  async getActiveTemplatesByStatus(status) {
    try {
      const q = query(
        collection(db, "emailTemplates"),
        where("statusFilter", "==", status),
        where("progress", "<", 100)
      );
      const snapshot = await getDocs(q);
      const templates = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      logger.info(
        `Fetched ${templates.length} active templates for status ${status}`
      );
      return templates;
    } catch (error) {
      logger.error(
        `Error fetching templates for status ${status}: ${error.message}`
      );
      return [];
    }
  }

  // Adiciona todos os templates ativos ao pendingEmails
  async addAllTemplatesToPendingEmails(checkoutId, status) {
    try {
      const templates = await this.getActiveTemplatesByStatus(status);
      if (templates.length > 0) {
        const templateIds = templates.map((t) => t.id);
        const checkoutRef = doc(db, "checkouts", checkoutId);
        await updateDoc(checkoutRef, {
          pendingEmails: arrayUnion(...templateIds),
        });
        logger.info(
          `Added templates to pendingEmails for checkout ${checkoutId}: ${templateIds}`
        );
      } else {
        logger.info(
          `No active templates found for status ${status} in checkout ${checkoutId}`
        );
      }
    } catch (error) {
      logger.error(
        `Error adding templates to checkout ${checkoutId}: ${error.message}`
      );
    }
  }

  // Reseta pendingEmails e adiciona os correspondentes ao novo status
  async resetAndUpdatePendingEmails(checkoutId, newStatus) {
    try {
      const checkoutRef = doc(db, "checkouts", checkoutId);
      const checkoutSnap = await getDoc(checkoutRef);
      if (!checkoutSnap.exists()) {
        throw new Error(`Checkout ${checkoutId} not found`);
      }
      const checkoutData = checkoutSnap.data();
      const currentPendingEmails = checkoutData.pendingEmails || [];

      // Remove todos os pendingEmails atuais
      if (currentPendingEmails.length > 0) {
        await updateDoc(checkoutRef, {
          pendingEmails: arrayRemove(...currentPendingEmails),
        });
        logger.info(
          `Removed pendingEmails from checkout ${checkoutId}: ${currentPendingEmails}`
        );
      }

      // Adiciona os novos templates
      const templates = await this.getActiveTemplatesByStatus(newStatus);
      if (templates.length > 0) {
        const templateIds = templates.map((t) => t.id);
        await updateDoc(checkoutRef, {
          pendingEmails: arrayUnion(...templateIds),
        });
        logger.info(
          `Updated pendingEmails for checkout ${checkoutId}: ${templateIds}`
        );
      } else {
        logger.info(
          `No active templates found for status ${newStatus} in checkout ${checkoutId}`
        );
      }
    } catch (error) {
      logger.error(
        `Error resetting and updating pendingEmails for checkout ${checkoutId}: ${error.message}`
      );
    }
  }
}

module.exports = new CheckoutRepository();
