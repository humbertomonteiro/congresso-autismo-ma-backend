const fs = require("fs").promises;
const path = require("path");
const puppeteer = require("puppeteer");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const config = require("../config");

const BASE_PRICE = 549.0;
const HALF_PRICE = 399.0;

const calculateTotal = (ticketQuantity, halfTickets, coupon) => {
  if (!Number.isInteger(ticketQuantity) || ticketQuantity <= 0) {
    throw new Error("Quantidade de ingressos inválida.");
  }
  if (
    !Number.isInteger(halfTickets) ||
    halfTickets < 0 ||
    halfTickets > ticketQuantity
  ) {
    throw new Error("Número de ingressos meia inválido.");
  }

  const fullTickets = ticketQuantity - halfTickets;
  const valueTicketsAll = fullTickets * BASE_PRICE;
  const valueTicketsHalf = halfTickets * HALF_PRICE;
  let discount = 0;

  if (coupon === "grupo" && ticketQuantity >= 5) {
    discount = (ticketQuantity - halfTickets) * 100;
  } else if (coupon === "terapeuta") {
    discount = 50;
  } else if (coupon && coupon !== "grupo") {
    throw new Error("Cupom inválido.");
  }

  const total = valueTicketsAll + valueTicketsHalf - discount;

  return {
    valueTicketsAll: valueTicketsAll.toFixed(2),
    valueTicketsHalf: valueTicketsHalf.toFixed(2),
    discount: discount.toFixed(2),
    total: total.toFixed(2),
    totalInCents: Math.round(total * 100),
  };
};

const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

const generateTicketPDF = async (recipient, qrCodes) => {
  const tempDir = path.join(__dirname, "../temp");
  const pdfPath = path.join(
    tempDir,
    `tickets_${recipient.checkoutId}_${recipient.participantIndex}.pdf`
  );

  await fs.mkdir(tempDir, { recursive: true });

  // Assume que qrCodes já vem em base64 (data:image/png;base64,...)
  const qrCodeDay1 = qrCodes["2025-05-31"];
  const qrCodeDay2 = qrCodes["2025-06-01"];

  const templatePath = path.join(__dirname, "../templates/ticketTemplate.html");
  const htmlTemplate = await fs.readFile(templatePath, "utf8");

  const htmlContent = htmlTemplate
    .replace(/{{PARTICIPANT_NAME}}/g, recipient.participantName.toUpperCase())
    .replace(/{{QRCODE_DAY1}}/g, qrCodeDay1)
    .replace(/{{QRCODE_DAY2}}/g, qrCodeDay2)
    .replace(/{{EVENT_NAME}}/g, "CONGRESSO AUTISMO MA 2025")
    .replace(/{{DATE_DAY1}}/g, "31.05.2025")
    .replace(/{{DATE_DAY2}}/g, "01.06.2025")
    .replace(/{{LOCATION}}/g, "CENTRO DE CONVENÇÕES MA")
    .replace(/{{TIME}}/g, "08:00 - 18:00")
    .replace(/{{SUPPORT_EMAIL}}/g, "suporte@congressoautismoma.com.br");

  const executablePath =
    process.env.NODE_ENV === "production"
      ? "/usr/local/chromium/chrome"
      : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await browser.close();

  console.log("PDF gerado com sucesso em:", pdfPath);
  return pdfPath;
};

const generateBoletoPDF = async (
  response,
  payer,
  customer,
  ticketQuantity,
  halfTickets,
  coupon,
  participants,
  dataVencimento
) => {
  const calculation = calculateTotal(ticketQuantity, halfTickets, coupon);
  const fullTickets = ticketQuantity - halfTickets;

  const barcodeBuffer = await new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "interleaved2of5",
        text: response.codigoBarraNumerico,
        scale: 3,
        height: 10,
        includetext: false,
      },
      (err, buffer) => (err ? reject(err) : resolve(buffer))
    );
  });

  const qrCodeBuffer = await QRCode.toBuffer(response.qrCode.emv, { scale: 5 });
  const barcodeBase64 = barcodeBuffer.toString("base64");
  const qrCodeBase64 = qrCodeBuffer.toString("base64");

  const templatePath = path.join(__dirname, "../templates/boletoTemplate.html");
  const htmlTemplate = await fs.readFile(templatePath, "utf8");

  let participantsFormatted = participants.map((p) => p.name).join("<br>");

  // Proteger contra undefined e formatar CPF/CNPJ dinamicamente
  const documentFormatted =
    customer.IdentityType === "cpf"
      ? (customer.Identity || "").replace(
          /(\d{3})(\d{3})(\d{3})(\d{2})/,
          "$1.$2.$3-$4"
        )
      : (customer.Identity || "").replace(
          /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
          "$1.$2.$3/$4-$5"
        );

  const zipCodeFormatted = (payer.zipCode || "").replace(
    /(\d{5})(\d{3})/,
    "$1-$2"
  );

  const htmlContent = htmlTemplate
    .replace(
      /{{LOGO_URL}}/g,
      "https://upload.wikimedia.org/wikipedia/commons/c/c6/Banco_do_Brasil_logo_%28old%29.svg"
    )
    .replace(
      /{{LINHA_DIGITAVEL}}/g,
      response.linhaDigitavel || "Não disponível"
    )
    .replace(/{{BENEFICIARIO_NOME}}/g, "CONGRESSO AUTISMO MA LTDA")
    .replace(/{{BENEFICIARIO_CNPJ}}/g, "27.943.639/0001-67")
    .replace(/{{BENEFICIARIO_ENDERECO}}/g, "Endereço do Beneficiário")
    .replace(
      /{{AGENCIA_CONTA}}/g,
      `${config.bancoDoBrasil.agencia} / ${config.bancoDoBrasil.conta}`
    )
    .replace(/{{NOSSO_NUMERO}}/g, response.numero || "Não disponível")
    .replace(/{{QUANTIDADE}}/g, ticketQuantity.toString())
    .replace(/{{PAGADOR_NOME}}/g, (customer.Name || "").toUpperCase())
    .replace(/{{PAGADOR_CPF}}/g, documentFormatted || "Não informado")
    .replace(
      /{{PAGADOR_ENDERECO}}/g,
      `${(payer.street || "").toUpperCase()}, ${(
        payer.addressNumber || ""
      ).toUpperCase()}, ${(payer.district || "").toUpperCase()}, ${(
        payer.city || ""
      ).toUpperCase()} - ${(payer.state || "").toUpperCase()}, CEP: ${
        zipCodeFormatted || "Não informado"
      }`
    )
    .replace(/{{NUMERO_BOLETO}}/g, response.numero || "Não disponível")
    // .replace(
    //   /{{DATA_VENCIMENTO}}/g,
    //   formatDate(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000))
    // )
    .replace(/{{DATA_VENCIMENTO}}/g, formatDate(new Date(dataVencimento)))
    .replace(/{{DATA_EMISSAO}}/g, formatDate(new Date()))
    .replace(/{{DATA_PROCESSAMENTO}}/g, new Date().toLocaleDateString("pt-BR"))
    .replace(/{{VALOR}}/g, calculation.total)
    .replace(/{{CARTEIRA}}/g, config.bancoDoBrasil.numeroCarteira.toString())
    .replace(
      /{{DEMONSTRATIVO}}/g,
      "APÓS O VENCIMENTO, MULTA DE 3,00% E MORA DIÁRIA DE R$ 1,00<br>CNPJ DO BENEFICIÁRIO: 27.943.639/0001-67"
    )
    .replace(/{{CODIGO_BARRAS_URL}}/g, `data:image/png;base64,${barcodeBase64}`)
    .replace(/{{QRCODE_URL}}/g, `data:image/png;base64,${qrCodeBase64}`)
    .replace(/{{QRCODE_EMV}}/g, response.qrCode.emv || "Não disponível")
    .replace(/{{TICKET_QUANTITY_FULL}}/g, fullTickets.toString())
    .replace(/{{TICKET_QUANTITY_HALF}}/g, halfTickets.toString())
    .replace(/{{VALUE_TICKETS_ALL}}/g, calculation.valueTicketsAll)
    .replace(/{{VALUE_TICKETS_HALF}}/g, calculation.valueTicketsHalf)
    .replace(/{{DISCOUNT}}/g, calculation.discount)
    .replace(/{{TOTAL}}/g, calculation.total)
    .replace(/{{PARTICIPANTS}}/g, participantsFormatted);

  const tempDir = path.join(__dirname, "../temp");
  const pdfPath = path.join(tempDir, `boleto_${response.numero}.pdf`);
  await fs.mkdir(tempDir, { recursive: true });

  const executablePath =
    process.env.NODE_ENV === "production"
      ? "/usr/local/chromium/chrome"
      : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await browser.close();

  return pdfPath;
};

module.exports = { generateTicketPDF, generateBoletoPDF };
