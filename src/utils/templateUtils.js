const fs = require("fs").promises;
const path = require("path");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const config = require("../config");
const { calculateTotal } = require("./calculateTotal");

/**
 * Retorna uma instância do browser Puppeteer compatível com o ambiente atual.
 *
 * Prioridade:
 *  1. PUPPETEER_EXECUTABLE_PATH  — caminho explícito via variável de ambiente
 *     (ex: /usr/bin/google-chrome-stable no Render após instalar o Chrome)
 *  2. puppeteer padrão (bundled Chromium) — funciona localmente quando o
 *     Chrome foi instalado com `npx puppeteer browsers install chrome`
 */
async function launchBrowser() {
  const puppeteer = require("puppeteer");
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];

  // 1. Caminho explícito via env var (opcional no Render)
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath) {
    return puppeteer.launch({ headless: true, executablePath, args });
  }

  // 2. Chromium instalado pelo próprio puppeteer (npx puppeteer browsers install chrome)
  //    puppeteer.executablePath() resolve o caminho correto independente do SO / versão
  try {
    const builtinPath = puppeteer.executablePath();
    if (builtinPath) {
      return puppeteer.launch({ headless: true, executablePath: builtinPath, args });
    }
  } catch (_) { /* ignora se executablePath() não estiver disponível */ }

  // 3. Fallback: deixa o puppeteer descobrir sozinho
  return puppeteer.launch({ headless: true, args });
}

const CONFIG_DOC = config.firebase.db.doc("config/eventConfig");
const CERT_CONFIG_DOC = config.firebase.db.doc("config/certificateConfig");

const DEFAULT_EVENT = {
  name: "CONGRESSO AUTISMO MA 2026",
  dates: ["2026-05-16", "2026-05-17"],
};

const FRONTEND_URL = "https://congressoautismoma.com.br";

// Fallback URLs por template type (usados quando o Firestore não tem config)
const FALLBACK_BACKGROUND_URLS = {
  default:      `${FRONTEND_URL}/assets/certificate-k6vpepnP.png`,
  cientifica:   `${FRONTEND_URL}/assets/certificate-cientifica-0WDywksV.png`,
  monitoria:    `${FRONTEND_URL}/assets/certificate-monitoria-BBuHPPDa.png`,
  organizadora: `${FRONTEND_URL}/assets/certificate-organizadora-CPpBqw_N.png`,
};

// Cache em memória do certificateConfig com TTL de 5 min
let _certConfigCache = null;
let _certConfigCachedAt = 0;

async function getCertificateBackgroundUrl(eventName, templateType) {
  const now = Date.now();
  if (!_certConfigCache || now - _certConfigCachedAt > 5 * 60 * 1000) {
    try {
      const snap = await CERT_CONFIG_DOC.get();
      _certConfigCache = snap.exists ? snap.data() : {};
      _certConfigCachedAt = now;
    } catch (_) {
      _certConfigCache = {};
    }
  }

  const type = templateType || "participante";
  const url = _certConfigCache?.events?.[eventName]?.[type];
  return url || FALLBACK_BACKGROUND_URLS[type] || `${FRONTEND_URL}/certificado-${type}.png`;
}

async function getEventConfig() {
  try {
    const snap = await CONFIG_DOC.get();
    if (snap.exists) {
      const data = snap.data();
      return {
        name:  (data.eventName  || DEFAULT_EVENT.name).toUpperCase(),
        dates: data.eventDates  || DEFAULT_EVENT.dates,
      };
    }
  } catch (_) { /* use defaults */ }
  return DEFAULT_EVENT;
}

const formatDateDot = (isoDate) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
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

  const event = await getEventConfig();
  const date1 = event.dates[0] || DEFAULT_EVENT.dates[0];
  const date2 = event.dates[1] || DEFAULT_EVENT.dates[1];

  // Assume que qrCodes já vem em base64 (data:image/png;base64,...)
  const qrCodeDay1 = qrCodes[date1];
  const qrCodeDay2 = qrCodes[date2];

  const templatePath = path.join(__dirname, "../templates/ticketTemplate.html");
  const htmlTemplate = await fs.readFile(templatePath, "utf8");

  const htmlContent = htmlTemplate
    .replace(/{{PARTICIPANT_NAME}}/g, recipient.participantName.toUpperCase())
    .replace(/{{QRCODE_DAY1}}/g, qrCodeDay1)
    .replace(/{{QRCODE_DAY2}}/g, qrCodeDay2)
    .replace(/{{EVENT_NAME}}/g, event.name)
    .replace(/{{DATE_DAY1}}/g, formatDateDot(date1))
    .replace(/{{DATE_DAY2}}/g, formatDateDot(date2))
    .replace(/{{LOCATION}}/g, "CENTRO DE CONVENÇÕES MA")
    .replace(/{{TIME}}/g, "08:00 - 18:00")
    .replace(/{{SUPPORT_EMAIL}}/g, "suporte@congressoautismoma.com.br");

  const browser = await launchBrowser();

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
  socialTickets,
  coupon,
  participants,
  dataVencimento
) => {
  const fullTickets = ticketQuantity - halfTickets - socialTickets;
  const calculation = await calculateTotal(
    fullTickets,
    halfTickets,
    socialTickets,
    coupon
  );

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

  const qrCodeEmv = response.qrCode?.emv || response.qrCodeEmv || null;
  const qrCodeBase64 = qrCodeEmv
    ? (await QRCode.toBuffer(qrCodeEmv, { scale: 5 })).toString("base64")
    : null;
  const barcodeBase64 = barcodeBuffer.toString("base64");

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
    .replace(/{{QRCODE_URL}}/g, qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : "")
    .replace(/{{QRCODE_EMV}}/g, qrCodeEmv || "Não disponível")
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

  const browser = await launchBrowser();

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await browser.close();

  return pdfPath;
};

const generateCertificatePDF = async (cpf, name, templateHTML, eventName) => {
  const tempDir = path.join(__dirname, "../temp");
  const pdfPath = path.join(tempDir, `certificate_${cpf}.pdf`);

  await fs.mkdir(tempDir, { recursive: true });

  if (!templateHTML) {
    templateHTML = "participante";
  }

  const specificTemplate = path.join(
    __dirname,
    `../templates/certificateTemplate-${templateHTML}.html`
  );
  const defaultTemplate = path.join(
    __dirname,
    "../templates/certificateTemplate-default.html"
  );
  const templatePath = await fs.access(specificTemplate).then(() => specificTemplate).catch(() => defaultTemplate);
  const htmlTemplate = await fs.readFile(templatePath, "utf8");

  const event = await getEventConfig();
  const resolvedEventName = eventName || event.name;
  const backgroundUrl = await getCertificateBackgroundUrl(resolvedEventName, templateHTML);

  const htmlContent = htmlTemplate
    .replace(/{{BACKGROUND_IMAGE}}/g, backgroundUrl)
    .replace(/{{PARTICIPANT_NAME}}/g, name.toUpperCase())
    .replace(/{{EVENT_NAME}}/g, event.name)
    .replace(/{{ISSUE_DATE}}/g, formatDate(new Date()));

  const browser = await launchBrowser();

  const page = await browser.newPage();
  // await page.setViewport({ width: 842, height: 595 });
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: {
      top: "0mm",
      right: "0mm",
      bottom: "0mm",
      left: "0mm",
    },
  });
  await browser.close();

  console.log("Certificado PDF gerado com sucesso em:", pdfPath);
  return pdfPath;
};

module.exports = {
  generateTicketPDF,
  generateBoletoPDF,
  generateCertificatePDF,
};
