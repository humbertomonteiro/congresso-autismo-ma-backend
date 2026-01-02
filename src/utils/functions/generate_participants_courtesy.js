const PDFDocument = require("pdfkit");
const fs = require("fs");
const CheckoutRepository = require("../../repositories/CheckoutRepository");
const logger = require("../../logger");

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

// Função para formatar texto com quebra de linha e calcular altura
const wrapText = (doc, text, x, y, maxWidth, lineHeight) => {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (let word of words) {
    const testLine = line + word + " ";
    const testWidth = doc.widthOfString(testLine);
    if (testWidth > maxWidth && line !== "") {
      doc.text(line, x, currentY);
      line = word + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  doc.text(line, x, currentY);
  return currentY + lineHeight;
};

// Função para gerar o PDF
const generateParticipantsList = async () => {
  try {
    console.log("Buscando checkouts aprovados...");
    const checkouts = await CheckoutRepository.fetchCheckouts({
      status: "approved",
      paymentMethod: "courtesy",
    });
    console.log(`Encontrados ${checkouts.length} checkouts aprovados.`);

    // Coletar participantes que compareceram
    const participants = [];
    checkouts.forEach((checkout) => {
      if (checkout.participants && Array.isArray(checkout.participants)) {
        const observation = checkout.observation || "";
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
              observation,
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
    const lineHeight = 12; // Reduzido para fonte menor
    const fontSize = 7; // Fonte reduzida
    const nameWidth = 150;
    const emailWidth = 160; // Aumentado para mais espaço
    const phoneWidth = 60; // Reduzido para dar espaço ao e-mail
    const observationWidth = 150;

    let y = margin + 14;
    let isFirstPage = true;

    // Adicionar título
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(
      "Lista de Participantes - Congresso Autismo MA 2026",
      margin,
      margin
    );
    doc.font("Helvetica").fontSize(fontSize);

    // Cabeçalho
    doc.font("Helvetica-Bold");
    doc.text("Nome", margin + 2, y + 2);
    doc.text("E-mail", margin + nameWidth + 2, y + 2);
    doc.text("Celular", margin + nameWidth + emailWidth + 2, y + 2);
    doc.text(
      "Observação",
      margin + nameWidth + emailWidth + phoneWidth + 2,
      y + 2
    );
    y += lineHeight + 6;

    // Adicionar participantes
    participants.forEach((p, index) => {
      // Calcular altura da observação
      const observationLines =
        Math.ceil(
          doc.widthOfString(p.observation.substring(0, 100)) / observationWidth
        ) || 1;
      const rowHeight = lineHeight * Math.max(1, observationLines);

      // Verificar se precisa de nova página
      if (y + rowHeight + 6 > pageHeight - margin) {
        doc.addPage();
        isFirstPage = false;
        y = margin;
        // Repetir cabeçalho
        doc.font("Helvetica-Bold").fontSize(fontSize);
        doc.text("Nome", margin + 2, y + 2);
        doc.text("E-mail", margin + nameWidth + 2, y + 2);
        doc.text("Celular", margin + nameWidth + emailWidth + 2, y + 2);
        doc.text(
          "Observação",
          margin + nameWidth + emailWidth + phoneWidth + 2,
          y + 2
        );
        y += lineHeight + 6;
        doc.font("Helvetica").fontSize(fontSize);
      }

      // Adicionar fundo alternado
      const fillColor = index % 2 === 0 ? "#F5F5F5" : "#FFFFFF"; // Cinza claro e branco
      doc
        .rect(margin, y, pageWidth - 2 * margin, rowHeight)
        .fillColor(fillColor)
        .fillOpacity(1)
        .fill();

      // Adicionar participante
      doc.fillColor("black").fillOpacity(1);
      doc.text(p.name.substring(0, 30), margin + 2, y + 2);
      doc.text(p.email.substring(0, 50), margin + nameWidth + 2, y + 2); // Aumentado limite para 50 caracteres
      doc.text(p.phone, margin + nameWidth + emailWidth + 2, y + 2);
      y = wrapText(
        doc,
        p.observation.substring(0, 100),
        margin + nameWidth + emailWidth + phoneWidth + 2,
        y + 2,
        observationWidth,
        lineHeight
      );

      y += 4; // Espaço extra após a linha
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
