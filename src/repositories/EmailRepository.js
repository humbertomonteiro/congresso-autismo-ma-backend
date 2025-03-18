const { firebase } = require("../config");
const {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
} = require("firebase/firestore");

const db = firebase.db;

class EmailRepository {
  async fetchEmailTemplates() {
    const snapshot = await getDocs(collection(db, "emailTemplates"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async fetchCheckouts() {
    const snapshot = await getDocs(collection(db, "checkouts"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async updateCheckout(checkoutId, data) {
    const checkoutRef = doc(db, "checkouts", checkoutId);
    await updateDoc(checkoutRef, data);
  }

  async updateParticipant(checkoutId, participantIndex, data) {
    const checkoutRef = doc(db, "checkouts", checkoutId);
    const checkoutSnap = await getDoc(checkoutRef);
    const checkoutData = checkoutSnap.data();
    checkoutData.participants[participantIndex] = {
      ...checkoutData.participants[participantIndex],
      ...data,
    };
    await updateDoc(checkoutRef, { participants: checkoutData.participants });
  }

  async createContactList(listData) {
    const docRef = await addDoc(collection(db, "contactLists"), listData);
    return docRef.id;
  }

  async addContactToList(listId, email) {
    const listRef = doc(db, "contactLists", listId);
    const listDoc = await getDoc(listRef);
    if (!listDoc.exists()) throw new Error("Lista não encontrada.");
    const listData = listDoc.data();
    const updatedContacts = [...(listData.contacts || []), email];
    await updateDoc(listRef, { contacts: updatedContacts });
  }
}

module.exports = new EmailRepository();
