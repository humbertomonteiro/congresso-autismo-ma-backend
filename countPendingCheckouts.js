const { db } = require("./src/config").firebase;
const { collection, query, where, getDocs } = require("firebase/firestore");
const logger = require("./src/logger");

async function countPendingCheckouts() {
  try {
    logger.info("Contando checkouts com qrCodesSent: false...");

    // Buscar checkouts com qrCodesSent: false
    const checkoutsRef = collection(db, "checkouts");
    const q = query(checkoutsRef, where("qrCodesSent", "==", false));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      logger.info(
        "Nenhum checkout pendente encontrado com qrCodesSent: false."
      );
      return { totalCheckouts: 0, totalParticipants: 0, details: [] };
    }

    let totalCheckouts = querySnapshot.size;
    let totalParticipants = 0;
    const details = [];

    // Contar participantes e coletar detalhes
    querySnapshot.forEach((doc) => {
      const checkout = doc.data();
      const checkoutId = doc.id;
      const participantCount = checkout.participants?.length || 0;
      totalParticipants += participantCount;
      details.push({
        checkoutId,
        participantCount,
        participants: checkout.participants.map((p) => ({
          email: p.email,
          name: p.name || "Sem nome",
        })),
      });
    });

    logger.info(`Total de checkouts pendentes: ${totalCheckouts}`);
    logger.info(
      `Total de participantes para enviar e-mails: ${totalParticipants}`
    );
    logger.info("Detalhes:", JSON.stringify(details, null, 2));

    return { totalCheckouts, totalParticipants, details };
  } catch (error) {
    logger.error(`Erro ao contar checkouts pendentes: ${error.message}`);
    throw error;
  }
}

// Executar o script
countPendingCheckouts()
  .then((result) => {
    console.log(`Total de checkouts: ${result.totalCheckouts}`);
    console.log(`Total de participantes: ${result.totalParticipants}`);
    console.log("Detalhes:", JSON.stringify(result.details, null, 2));
  })
  .catch((error) => {
    console.error(`Erro ao executar o script: ${error.message}`);
    process.exit(1);
  });
