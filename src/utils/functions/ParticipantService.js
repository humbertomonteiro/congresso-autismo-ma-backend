const config = require("../../config");
const { collection, query, where, getDocs } = require("firebase/firestore");

const db = config.firebase.db;

async function getApprovedParticipants2025() {
  const participantsRef = collection(db, "checkouts");

  const q = query(
    participantsRef,
    where("eventName", "==", "Congresso Autismo MA 2026"),
    where("status", "==", "approved")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  getApprovedParticipants2025,
};
