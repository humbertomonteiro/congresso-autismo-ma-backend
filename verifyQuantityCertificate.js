const config = require("./src/config");
const db = config.firebase.db;

const { collection, getDocs } = require("firebase/firestore");

const getParticipantsCielo = async () => {
  try {
    const docRef = collection(db, "participantes-certificado");
    const snapshot = await getDocs(docRef);

    const count = snapshot.size; // forma mais simples de contar

    console.log(`Total de participantes: ${count}`);
    return count;
  } catch (err) {
    console.log("Error getting documents", err);
  }
};

getParticipantsCielo();
