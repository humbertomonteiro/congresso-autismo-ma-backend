const PDFDocument = require("pdfkit");
const fs = require("fs");
const CheckoutRepository = require("./src/repositories/CheckoutRepository");
const logger = require("./src/logger");

// Função para formatar número de celular
const formatPhone = (phone) => {
  if (!phone) return "";
  const cleanPhone = phone.replace(/[^\d]/g, "").trim();
  if (cleanPhone.length === 11) {
    return cleanPhone
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d)/, "$1-$2");
  }
  return cleanPhone;
};

// Função para gerar o PDF
const generateParticipantsList = async () => {
  try {
    console.log("Buscando checkouts aprovados...");
    const checkouts = await CheckoutRepository.fetchCheckouts({
      status: "approved",
    });
    console.log(`Encontrados ${checkouts.length} checkouts aprovados.`);

    // Coletar participantes que compareceram
    const participants = [];
    checkouts.forEach((checkout) => {
      if (checkout.participants && Array.isArray(checkout.participants)) {
        checkout.participants.forEach((p) => {
          const name =
            p.name && typeof p.name === "string" ? p.name.trim() : "";
          const email = p.email || "";
          const phone = p.number || "";

          if (name && email) {
            participants.push({
              name,
              email,
              phone: formatPhone(phone),
            });
          }
        });
      }
    });

    if (participants.length === 0) {
      console.log("Nenhum participante encontrado que compareceu ao evento.");
      logger.info("Nenhum participante encontrado que compareceu ao evento.");
      return;
    }

    // Ordenar por nome
    participants.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    console.log(
      `Total de participantes que compareceram: ${participants.length}`
    );
    logger.info(
      `Total de participantes que compareceram a incluir no PDF: ${participants.length}`
    );

    // Criar PDF
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 28, bottom: 28, left: 28, right: 28 },
    });
    const outputPath = "lista_participantes.pdf";
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Configurações do layout
    const pageWidth = 595; // A4 width em pontos
    const pageHeight = 842; // A4 height em pontos
    const margin = 28; // ~10mm
    const lineHeight = 14; // ~5mm
    const fontSize = 8;
    const nameWidth = 200; // Reduzido para acomodar e-mail maior
    const emailWidth = 170; // Aumentado para e-mails longos
    const phoneWidth = 150; // Ajustado para balancear

    let y = margin + 14; // Início após o título
    let isFirstPage = true;

    // Adicionar título
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(
      "Lista de Participantes - Congresso Autismo MA 2026",
      margin,
      margin
    );
    doc.font("Helvetica").fontSize(fontSize);

    // Cabeçalho (apenas na primeira página)
    doc.text("Nome", margin, y);
    doc.text("E-mail", margin + nameWidth, y);
    doc.text("Celular", margin + nameWidth + emailWidth, y);
    y += lineHeight;
    doc
      .moveTo(margin, y - 4)
      .lineTo(pageWidth - margin, y - 4)
      .stroke(); // Linha abaixo do cabeçalho
    y += 6;

    // Adicionar participantes
    participants.forEach((p, index) => {
      // Verificar se precisa de nova página
      if (y + lineHeight > pageHeight - margin) {
        doc.addPage();
        isFirstPage = false;
        y = margin; // Começar do topo da nova página
      }

      // Adicionar participante
      doc.text(p.name.substring(0, 40), margin, y); // Limita nome a 40 caracteres
      doc.text(p.email.substring(0, 50), margin + nameWidth, y); // Limita e-mail a 50 caracteres
      doc.text(p.phone, margin + nameWidth + emailWidth, y); // Adiciona número de celular
      y += lineHeight;
    });

    // Finalizar PDF
    doc.end();
    stream.on("finish", () => {
      console.log(`PDF gerado com sucesso: ${outputPath}`);
      logger.info(`PDF gerado com sucesso: ${outputPath}`);
    });
  } catch (error) {
    console.error("Erro ao gerar lista de participantes:", error);
    logger.error(`Erro ao gerar lista de participantes: ${error.message}`);
  }
};

// Executar
generateParticipantsList();
