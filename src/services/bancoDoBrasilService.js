// src/services/BancoDoBrasilService.js
const axios = require("axios");
const https = require("https");
const config = require("../config");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const CheckoutService = require("./CheckoutService");

class BancoDoBrasilService {
  constructor() {
    this.authBaseUrl = config.bancoDoBrasil.authBaseUrl;
    this.apiBaseUrl = config.bancoDoBrasil.baseUrl;
    this.agent = new https.Agent({
      rejectUnauthorized: false,
      // pfx: fs.readFileSync(config.bancoDoBrasil.certificadoPfx),
      // passphrase: config.bancoDoBrasil.certificadoSenha,
    });
  }

  formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  async requestWithRetries(url, payload, headers, retries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers,
          httpsAgent: this.agent,
          timeout: 10000,
        });
        return response.data;
      } catch (error) {
        console.error(`Tentativa ${attempt} falhou:`, error.message);
        if (attempt === retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  async getAccessToken() {
    const auth = Buffer.from(
      `${config.bancoDoBrasil.clientId}:${config.bancoDoBrasil.clientSecret}`
    ).toString("base64");
    const response = await axios.post(
      `${this.authBaseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "cobrancas.boletos-info cobrancas.boletos-requisicao",
      }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: this.agent,
      }
    );
    return response.data.access_token;
  }

  async createPixPayment(amount, customer) {
    const token = await this.getAccessToken();
    const pixEndpoint = `${this.apiBaseUrl}/pix/v2/cob?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;
    const txId = `TX${Date.now()}`;

    const payload = {
      calendario: {
        expiracao: 3600, // 1 hora
      },
      devedor: {
        cpf: customer.Identity,
        nome: customer.Name,
      },
      valor: {
        original: (amount / 100).toFixed(2),
      },
      chave: "saludcuidarmais@gmail.com", // Chave Pix fixa
      solicitacaoPagador: "Pagamento Congresso Autismo MA 2025",
      infoAdicionais: [{ nome: "Evento", valor: "Congresso Autismo MA 2025" }],
    };

    const response = await this.requestWithRetries(pixEndpoint, payload, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    return {
      txId: response.txid,
      qrCode: response.qrcode.qrCode,
      qrCodeLink: response.qrcode.linkVisualizacao,
      expirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async createBoletoPayment(
    amount,
    customer,
    boletoData,
    ticketQuantity,
    halfTickets,
    coupon,
    participants
  ) {
    const token = await this.getAccessToken();
    const boletoEndpoint = `${this.apiBaseUrl}/boletos?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;
    console.log("Endpoint:", boletoEndpoint);
    console.log("Token:", token);

    const numeroControle = Date.now().toString().slice(-10).padStart(10, "0");
    const numeroTituloCliente = `000${config.bancoDoBrasil.numeroConvenio}${numeroControle}`;
    const cepSemHifen = boletoData.zipCode.replace(/[^0-9]/g, "");

    const payload = {
      numeroConvenio: parseInt(config.bancoDoBrasil.numeroConvenio),
      numeroCarteira: parseInt(config.bancoDoBrasil.numeroCarteira),
      numeroVariacaoCarteira: parseInt(
        config.bancoDoBrasil.numeroVariacaoCarteira
      ),
      codigoModalidade: 1,
      dataEmissao: this.formatDate(new Date()),
      dataVencimento: this.formatDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      ),
      valorOriginal: (amount / 100).toFixed(2),
      valorAbatimento: 0,
      quantidadeDiasProtesto: 15,
      indicadorAceiteTituloVencido: "S",
      numeroDiasLimiteRecebimento: "",
      codigoAceite: "A",
      codigoTipoTitulo: "02",
      descricaoTipoTitulo: "DM",
      indicadorPermissaoRecebimentoParcial: "S",
      numeroTituloBeneficiario: `0${customer.Identity.slice(0, 4)}-DSD-1`,
      textoCampoUtilizacaoBeneficiario: "CONGRESSOAUTISMOMA2025",
      numeroTituloCliente: numeroTituloCliente,
      mensagemBloquetoOcorrencia: "",
      desconto: { tipo: 0 },
      jurosMora: { tipo: 1, valor: 1.0, porcentagem: 0 },
      multa: { tipo: 0, dados: "", porcentagem: 0, valor: 0 },
      pagador: {
        tipoInscricao: customer.Identity.length === 11 ? 1 : 2,
        numeroInscricao: customer.Identity.replace(/[^0-9]/g, ""),
        nome: customer.Name.toUpperCase(),
        endereco: `${boletoData.street.toUpperCase()} N ${
          boletoData.number || ""
        }`,
        cep: cepSemHifen,
        cidade: boletoData.city.toUpperCase(),
        bairro: boletoData.district.toUpperCase(),
        uf: boletoData.state.toUpperCase(),
        telefone: boletoData.phone || "",
      },
      beneficiarioFinal: {
        tipoInscricao: 2,
        numeroInscricao: parseInt(config.bancoDoBrasil.cnpj),
        nome: "CONGRESSO AUTISMO MA LTDA",
      },
      indicadorPix: "S",
      textoEnderecoEmail: "saludcuidarmais@gmail.com",
    };
    console.log("Payload enviado:", JSON.stringify(payload, null, 2));

    const response = await this.requestWithRetries(boletoEndpoint, payload, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    console.log("Resposta da API:", JSON.stringify(response, null, 2));

    const boletoFilePath = await this.generateBoletoPDF(
      response,
      boletoData,
      customer,
      ticketQuantity,
      halfTickets,
      coupon,
      participants
    );

    return {
      boletoUrl: response.linhaDigitavel,
      qrCodePix: response.qrCode?.url,
      numeroBoleto: response.numero,
      boletoFile: boletoFilePath,
    };
  }

  async generateBoletoPDF(
    response,
    boletoData,
    customer,
    ticketQuantity,
    halfTickets,
    coupon,
    participants
  ) {
    const calculation = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
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

    const qrCodeBuffer = await QRCode.toBuffer(response.qrCode.emv, {
      scale: 5,
    });
    const barcodeBase64 = barcodeBuffer.toString("base64");
    const qrCodeBase64 = qrCodeBuffer.toString("base64");

    const templatePath = path.join(
      __dirname,
      "../templates/boletoTemplate.html"
    );
    const htmlTemplate = fs.readFileSync(templatePath, "utf8");

    let participantsFormatted = participants.map((p) => p.name).join("<br>");

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
      .replace(/{{PAGADOR_NOME}}/g, customer.Name.toUpperCase())
      .replace(
        /{{PAGADOR_CPF}}/g,
        customer.Identity.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
      )
      .replace(
        /{{PAGADOR_ENDERECO}}/g,
        `${boletoData.street.toUpperCase()}, ${
          boletoData.number || ""
        }, ${boletoData.district.toUpperCase()}, ${boletoData.city.toUpperCase()} - ${boletoData.state.toUpperCase()}, CEP: ${boletoData.zipCode.replace(
          /(\d{5})(\d{3})/,
          "$1-$2"
        )}`
      )
      .replace(/{{NUMERO_BOLETO}}/g, response.numero || "Não disponível")
      .replace(
        /{{DATA_VENCIMENTO}}/g,
        this.formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      )
      .replace(/{{DATA_EMISSAO}}/g, this.formatDate(new Date()))
      .replace(
        /{{DATA_PROCESSAMENTO}}/g,
        new Date().toLocaleDateString("pt-BR")
      )
      .replace(/{{VALOR}}/g, calculation.total)
      .replace(/{{CARTEIRA}}/g, config.bancoDoBrasil.numeroCarteira.toString())
      .replace(
        /{{DEMONSTRATIVO}}/g,
        "APÓS O VENCIMENTO, MULTA DE 3,00% E MORA DIÁRIA DE R$ 1,00<br>CNPJ DO BENEFICIÁRIO: 27.943.639/0001-67"
      )
      .replace(
        /{{CODIGO_BARRAS_URL}}/g,
        `data:image/png;base64,${barcodeBase64}`
      )
      .replace(/{{QRCODE_URL}}/g, `data:image/png;base64,${qrCodeBase64}`)
      .replace(/{{QRCODE_EMV}}/g, response.qrCode.emv || "Não disponível")
      .replace(/{{TICKET_QUANTITY_FULL}}/g, fullTickets.toString())
      .replace(/{{TICKET_QUANTITY_HALF}}/g, halfTickets.toString())
      .replace(/{{VALUE_TICKETS_ALL}}/g, calculation.valueTicketsAll)
      .replace(/{{VALUE_TICKETS_HALF}}/g, calculation.valueTicketsHalf)
      .replace(/{{DISCOUNT}}/g, calculation.discount)
      .replace(/{{TOTAL}}/g, calculation.total)
      .replace(/{{PARTICIPANTS}}/g, participantsFormatted);

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
    const filePath = path.join(__dirname, `boleto_${response.numero}.pdf`);
    await page.pdf({ path: filePath, format: "A4", printBackground: true });
    await browser.close();

    return filePath;
  }
}

module.exports = new BancoDoBrasilService();
