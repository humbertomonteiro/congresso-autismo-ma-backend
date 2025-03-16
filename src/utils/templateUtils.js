const fs = require("fs").promises;
const path = require("path");
const puppeteer = require("puppeteer");

const generateTicketPDF = async (recipient, qrCodes) => {
  const tempDir = path.join(__dirname, "../temp");
  const pdfPath = path.join(
    tempDir,
    `tickets_${recipient.checkoutId}_${recipient.participantIndex}.pdf`
  );

  await fs.mkdir(tempDir, { recursive: true });
  const qrCodeDay1 = qrCodes["2025-05-31"].toString("base64");
  const qrCodeDay2 = qrCodes["2025-06-01"].toString("base64");

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

  return pdfPath;
};

module.exports = { generateTicketPDF };
