// src/services/checkApprovedQRCodeFormat.js
const { collection, getDocs } = require("firebase/firestore");
const config = require("./src/config");
require("dotenv").config();

const EVENT_DATES = ["2025-05-31", "2025-06-01"];

async function checkApprovedQRCodeFormat() {
  try {
    const checkoutsSnapshot = await getDocs(
      collection(config.firebase.db, "checkouts")
    );
    console.log(`Total de checkouts encontrados: ${checkoutsSnapshot.size}`);

    let approvedCheckouts = 0;
    let differentFormatParticipants = [];
    const expectedFields = [
      "checkoutId",
      "participantId",
      "participantName",
      "eventName",
      "date",
      "signature",
    ];

    for (const checkoutDoc of checkoutsSnapshot.docs) {
      const checkoutId = checkoutDoc.id;
      const checkout = checkoutDoc.data();

      // Filtrar apenas checkouts com status "approved"
      if (checkout.status !== "approved") {
        console.log(
          `Ignorando checkout ${checkoutId} (status: ${checkout.status})`
        );
        continue;
      }

      approvedCheckouts++;
      const participants = checkout.participants || [];

      console.log(
        `Verificando checkout aprovado ${checkoutId} com ${participants.length} participantes`
      );

      participants.forEach((participant, index) => {
        const participantId = `${checkoutId}-${index}`;
        const qrRawData = participant.qrRawData || {};

        EVENT_DATES.forEach((date) => {
          const qrDataString = qrRawData[date];
          if (!qrDataString) {
            differentFormatParticipants.push({
              checkoutId,
              participantId,
              participantName: participant.name,
              date,
              issue: "QR Code ausente para esta data",
              actualData: undefined,
            });
            return;
          }

          let parsedData;
          try {
            parsedData = JSON.parse(qrDataString);
          } catch (error) {
            differentFormatParticipants.push({
              checkoutId,
              participantId,
              participantName: participant.name,
              date,
              issue: `Formato inválido (não é JSON): ${error.message}`,
              actualData: undefined,
            });
            return;
          }

          // Verificar apenas a presença dos campos esperados
          const missingFields = expectedFields.filter(
            (field) => !(field in parsedData)
          );
          const extraFields = Object.keys(parsedData).filter(
            (field) => !expectedFields.includes(field)
          );

          let issues = [];
          if (missingFields.length > 0) {
            issues.push(`Campos ausentes: ${missingFields.join(", ")}`);
          }
          if (extraFields.length > 0) {
            issues.push(`Campos extras: ${extraFields.join(", ")}`);
          }

          if (issues.length > 0) {
            differentFormatParticipants.push({
              checkoutId,
              participantId,
              participantName: participant.name,
              date,
              issue: issues.join("; "),
              actualData: parsedData,
            });
          }
        });
      });
    }

    // Exibir resultados
    console.log(
      `Total de checkouts aprovados verificados: ${approvedCheckouts}`
    );
    if (differentFormatParticipants.length === 0) {
      console.log(
        "Todos os QR Codes dos checkouts aprovados têm o formato correto (campos esperados presentes)!"
      );
    } else {
      console.log(
        "Participantes com QR Codes em formato diferente nos checkouts aprovados:"
      );
      differentFormatParticipants.forEach((item, idx) => {
        console.log(`#${idx + 1}:`);
        console.log(`  Checkout ID: ${item.checkoutId}`);
        console.log(`  Participant ID: ${item.participantId}`);
        console.log(`  Nome: ${item.participantName}`);
        console.log(`  Data: ${item.date}`);
        console.log(`  Problema: ${item.issue}`);
        console.log(`  Dados reais:`, item.actualData);
        console.log("---");
      });
    }

    return differentFormatParticipants;
  } catch (error) {
    console.error(
      "Erro ao verificar formatos dos QR Codes dos checkouts aprovados:",
      error.message
    );
    throw error;
  }
}

// Executar a verificação
checkApprovedQRCodeFormat()
  .then(() => console.log("Verificação concluída"))
  .catch((err) => console.error("Erro na execução:", err));
