// const { firebase } = require("../config");
// const {
//   collection,
//   getDocs,
//   doc,
//   getDoc,
//   updateDoc,
//   addDoc,
// } = require("firebase/firestore");
// const logger = require("../logger");

// const db = firebase.db;

// class EmailRepository {
//   async fetchEmailTemplates() {
//     try {
//       const snapshot = await getDocs(collection(db, "emailTemplates"));
//       const templates = snapshot.docs.map((doc) => ({
//         id: doc.id,
//         ...doc.data(),
//       }));
//       logger.info(`Fetched ${templates.length} email templates`);
//       return templates;
//     } catch (error) {
//       logger.error(`Error fetching email templates: ${error.message}`);
//       throw error;
//     }
//   }

//   async updateTemplate(templateId, data) {
//     try {
//       const templateRef = doc(db, "emailTemplates", templateId);
//       await updateDoc(templateRef, data);
//       logger.info(
//         `Updated template ${templateId} with: ${JSON.stringify(data)}`
//       );
//     } catch (error) {
//       logger.error(`Error updating template ${templateId}: ${error.message}`);
//       throw error;
//     }
//   }

//   async updateCheckout(checkoutId, data) {
//     try {
//       const checkoutRef = doc(db, "checkouts", checkoutId);
//       await updateDoc(checkoutRef, data);
//       logger.info(`Updated checkout ${checkoutId}`);
//     } catch (error) {
//       logger.error(`Error updating checkout ${checkoutId}: ${error.message}`);
//       throw error;
//     }
//   }

//   async updateParticipant(checkoutId, participantIndex, data) {
//     try {
//       const checkoutRef = doc(db, "checkouts", checkoutId);
//       const checkoutSnap = await getDoc(checkoutRef);
//       if (!checkoutSnap.exists()) {
//         throw new Error(`Checkout ${checkoutId} not found`);
//       }
//       const checkoutData = checkoutSnap.data();
//       checkoutData.participants[participantIndex] = {
//         ...checkoutData.participants[participantIndex],
//         ...data,
//       };
//       await updateDoc(checkoutRef, { participants: checkoutData.participants });
//       logger.info(
//         `Updated participant ${participantIndex} in checkout ${checkoutId}`
//       );
//     } catch (error) {
//       logger.error(
//         `Error updating participant ${participantIndex} in checkout ${checkoutId}: ${error.message}`
//       );
//       throw error;
//     }
//   }

//   async createContactList(listData) {
//     try {
//       const docRef = await addDoc(collection(db, "contactLists"), listData);
//       logger.info(`Created new contact list with ID: ${docRef.id}`);
//       return docRef.id;
//     } catch (error) {
//       logger.error(`Error creating contact list: ${error.message}`);
//       throw error;
//     }
//   }

//   async addContactToList(listId, email) {
//     try {
//       const listRef = doc(db, "contactLists", listId);
//       const listDoc = await getDoc(listRef);
//       if (!listDoc.exists()) throw new Error("Lista não encontrada.");
//       const listData = listDoc.data();
//       const updatedContacts = [...(listData.contacts || []), email];
//       await updateDoc(listRef, { contacts: updatedContacts });
//       logger.info(`Added email ${email} to contact list ${listId}`);
//     } catch (error) {
//       logger.error(`Error adding contact to list ${listId}: ${error.message}`);
//       throw error;
//     }
//   }
// }

// module.exports = new EmailRepository();
const { db, admin } = require("../config").firebase;
const logger = require("../logger");

class EmailRepository {
  async fetchEmailTemplates() {
    try {
      const snapshot = await db.collection("emailTemplates").get();
      const templates = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      logger.info(`Fetched ${templates.length} email templates`);
      return templates;
    } catch (error) {
      logger.error(`Error fetching email templates: ${error.message}`);
      throw error;
    }
  }

  async updateTemplate(templateId, data) {
    try {
      await db.collection("emailTemplates").doc(templateId).update(data);
      logger.info(`Updated template ${templateId}`);
    } catch (error) {
      logger.error(`Error updating template ${templateId}: ${error.message}`);
      throw error;
    }
  }

  async createContactList(listData) {
    try {
      const ref = await db.collection("contactLists").add(listData);
      logger.info(`Created contact list: ${ref.id}`);
      return ref.id;
    } catch (error) {
      logger.error(`Error creating contact list: ${error.message}`);
      throw error;
    }
  }

  async addContactToList(listId, email) {
    try {
      const ref = db.collection("contactLists").doc(listId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Lista não encontrada.");
      const contacts = snap.data().contacts || [];
      await ref.update({ contacts: [...contacts, email] });
      logger.info(`Added ${email} to contact list ${listId}`);
    } catch (error) {
      logger.error(`Error adding contact to list ${listId}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new EmailRepository();
