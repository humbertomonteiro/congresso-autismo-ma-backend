const PDFDocument = require("pdfkit");
const fs = require("fs");
const CheckoutRepository = require("./src/repositories/CheckoutRepository");
const logger = require("./src/logger");

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

// Função para gerar o PDF
const generateParticipantsList = async () => {
  try {
    console.log("Buscando checkouts aprovados...");
    const checkouts = await CheckoutRepository.fetchCheckouts({
      status: "approved",
    });
    console.log(`Encontrados ${checkouts.length} checkouts aprovados.`);

    // Coletar participantes que foram ao evento (validated['2026-05-31'] === true)
    const participants = [];
    checkouts.forEach((checkout) => {
      if (checkout.participants && Array.isArray(checkout.participants)) {
        checkout.participants.forEach((p) => {
          const name =
            p.name && typeof p.name === "string" ? p.name.trim() : "";
          const cpf = p.cpf || p.document || "";
          // Verificar se o participante tem validated['2026-05-31'] === true
          const attendedFirstDay =
            p.validated && p.validated["2026-05-31"] === true;
          if (name && cpf && attendedFirstDay) {
            participants.push({
              name,
              cpf: formatCpf(cpf),
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
    const nameWidth = 255; // ~90mm
    const cpfWidth = 113; // ~40mm
    const signatureWidth = 170; // ~60mm

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
    doc.text("CPF", margin + nameWidth, y);
    doc.text("Assinatura", margin + nameWidth + cpfWidth, y);
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
      doc.text(p.name.substring(0, 50), margin, y); // Limita nome a 50 caracteres
      doc.text(p.cpf, margin + nameWidth, y);
      // Linha para assinatura
      doc
        .moveTo(margin + nameWidth + cpfWidth, y + 3)
        .lineTo(margin + nameWidth + cpfWidth + signatureWidth, y + 3)
        .stroke();
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
