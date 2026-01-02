const CheckoutRepository = require("../../repositories/CheckoutRepository");
const fs = require("fs");
const logger = require("../../logger");

// Função para formatar CPF
const formatCpf = (cpf) => {
  if (!cpf) return "";
  const cleanCpf = cpf.replace(/[^\d]/g, "").trim();
  if (cleanCpf.length === 11) {
    return cleanCpf
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return cleanCpf;
};

// Função para buscar participantes sem QR Codes
const findParticipantsWithoutQRCodes = async () => {
  try {
    console.log("Buscando checkouts aprovados...");
    const checkouts = await CheckoutRepository.fetchCheckouts({
      status: "approved",
    });
    console.log(`Encontrados ${checkouts.length} checkouts aprovados.`);

    // Coletar participantes sem QR Codes
    const participantsWithoutQRCodes = [];
    checkouts.forEach((checkout) => {
      if (checkout.participants && Array.isArray(checkout.participants)) {
        checkout.participants.forEach((p, index) => {
          const name =
            p.name && typeof p.name === "string" ? p.name.trim() : "";
          const cpf = p.cpf || p.document || "";
          const qrCodes = p.qrCodes || {};

          // Verificar se qrCodes está vazio ou ausente
          if (!qrCodes || Object.keys(qrCodes).length === 0) {
            if (name && cpf) {
              participantsWithoutQRCodes.push({
                checkoutId: checkout.id || "Desconhecido",
                participantIndex: index,
                name,
                cpf: formatCpf(cpf),
              });
            }
          }
        });
      }
    });

    if (participantsWithoutQRCodes.length === 0) {
      console.log("Nenhum participante sem QR Codes encontrado.");
      logger.info("Nenhum participante sem QR Codes encontrado.");
      return;
    }

    // Ordenar por nome
    participantsWithoutQRCodes.sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    );
    console.log(
      `Total de participantes sem QR Codes: ${participantsWithoutQRCodes.length}`
    );
    logger.info(
      `Total de participantes sem QR Codes: ${participantsWithoutQRCodes.length}`
    );

    // Salvar resultado em um arquivo JSON
    const outputPath = "participantes_sem_qrcodes.json";
    fs.writeFileSync(
      outputPath,
      JSON.stringify(participantsWithoutQRCodes, null, 2)
    );
    console.log(`Lista de participantes sem QR Codes salva em: ${outputPath}`);
    logger.info(`Lista de participantes sem QR Codes salva em: ${outputPath}`);
  } catch (error) {
    console.error("Erro ao buscar participantes sem QR Codes:", error);
    logger.error(`Erro ao buscar participantes sem QR Codes: ${error.message}`);
  }
};

// Executar
findParticipantsWithoutQRCodes();
