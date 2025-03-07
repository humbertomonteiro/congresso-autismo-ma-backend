const { db } = require("../config");
const { collection, addDoc } = require("firebase/firestore");

class CheckoutRepository {
  async saveCheckout(checkoutData) {
    try {
      const docRef = await addDoc(collection(db, "checkouts"), checkoutData);
      console.log("Checkout salvo com ID:", docRef.id);
      return { id: docRef.id, ...checkoutData };
    } catch (error) {
      throw new Error("Erro ao salvar checkout no Firestore: " + error.message);
    }
  }
}

module.exports = new CheckoutRepository();
