// src/repositories/CheckoutRepository.js
const config = require("../config");
const {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
} = require("firebase/firestore");

class CheckoutRepository {
  async saveCheckout(checkoutData) {
    const docRef = await addDoc(
      collection(config.firebase.db, "checkouts"),
      checkoutData
    );
    return docRef.id;
  }

  async getPendingCheckouts() {
    const checkoutsRef = collection(config.firebase.db, "checkouts");
    const q = query(checkoutsRef, where("status", "==", "pending"));
    const querySnapshot = await getDocs(q);
    const checkouts = [];
    querySnapshot.forEach((doc) => {
      checkouts.push({ id: doc.id, ...doc.data() });
    });
    // console.log(checkouts);
    return checkouts;
  }

  async updateCheckoutStatus(checkoutId, newStatus) {
    const checkoutRef = doc(config.firebase.db, "checkouts", checkoutId);
    await updateDoc(checkoutRef, { status: newStatus });
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
      await addDoc(collection(config.firebase.db, "checkouts"), checkoutData);
    }
  }
}

module.exports = new CheckoutRepository();
