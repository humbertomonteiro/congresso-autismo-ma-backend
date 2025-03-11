// src/services/bancoDoBrasilService.js
const axios = require("axios");
const https = require("https");
const { bancoDoBrasilConfig } = require("../config");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const CheckoutService = require("./checkoutService");

class BancoDoBrasilService {
  constructor() {
    this.authBaseUrl = bancoDoBrasilConfig.authBaseUrl;
    this.apiBaseUrl = bancoDoBrasilConfig.baseUrl;
    this.agent = new https.Agent({
      rejectUnauthorized: false, // Desabilitar verificação de certificado (apenas para testes)
      // Descomente se precisar usar o certificado
      // pfx: fs.readFileSync(bancoDoBrasilConfig.certificadoPfx),
      // passphrase: bancoDoBrasilConfig.certificadoSenha,
    });
  }

  // Função auxiliar para formatar data
  formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  // Função genérica para requisições com retentativas
  async requestWithRetries(url, payload, headers, retries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Tentativa ${attempt} - Enviando requisição para: ${url}`);
        console.log("Payload:", JSON.stringify(payload, null, 2));
        console.log("Headers:", headers);

        const response = await axios.post(url, payload, {
          headers,
          httpsAgent: this.agent,
          timeout: 10000,
        });

        console.log("Resposta recebida:", response.data);
        return response.data;
      } catch (error) {
        console.error(`Tentativa ${attempt} falhou:`, {
          status: error.response?.status,
          data: error.response?.data,
          headers: error.response?.headers,
          message: error.message,
        });
        if (attempt === retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  async getAccessToken(retries = 3, delayMs = 1000) {
    console.log("Tentando obter token em:", `${this.authBaseUrl}/oauth/token`);
    console.log("Usando Client ID:", bancoDoBrasilConfig.clientId);
    console.log("Usando Client Secret:", bancoDoBrasilConfig.clientSecret);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const auth = Buffer.from(
          `${bancoDoBrasilConfig.clientId}:${bancoDoBrasilConfig.clientSecret}`
        ).toString("base64");
        console.log("Authorization Header:", `Basic ${auth}`);

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
            timeout: 10000,
          }
        );
        console.log("Token obtido:", response.data.access_token);
        return response.data.access_token;
      } catch (error) {
        console.error(`Tentativa ${attempt} falhou:`, {
          status: error.response?.status,
          data: error.response?.data,
          headers: error.response?.headers,
          message: error.message,
        });
        if (attempt === retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  async createBoletoPayment(
    amount,
    customer,
    boletoData,
    ticketQuantity,
    halfTickets,
    coupon
  ) {
    const token = await this.getAccessToken();
    const boletoEndpoint = `${this.apiBaseUrl}/boletos?gw-dev-app-key=${bancoDoBrasilConfig.developerApiKey}`;
    console.log("Enviando requisição Boleto para:", boletoEndpoint);

    const numeroControle = Date.now().toString().slice(-10).padStart(10, "0");
    const numeroTituloCliente = `000${bancoDoBrasilConfig.numeroConvenio}${numeroControle}`;

    const cepSemHifen = boletoData.zipCode.replace(/[^0-9]/g, "");

    const payload = {
      numeroConvenio: parseInt(bancoDoBrasilConfig.numeroConvenio),
      numeroCarteira: parseInt(bancoDoBrasilConfig.numeroCarteira),
      numeroVariacaoCarteira: parseInt(
        bancoDoBrasilConfig.numeroVariacaoCarteira
      ),
      codigoModalidade: 1,
      dataEmissao: this.formatDate(new Date()).replace(/\//g, "."),
      dataVencimento: this.formatDate(
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      ).replace(/\//g, "."),
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
        numeroInscricao: parseInt(bancoDoBrasilConfig.cnpj),
        nome: "CONGRESSO AUTISMO MA LTDA",
      },
      indicadorPix: "S",
      textoEnderecoEmail: "saludcuidarmais@gmail.com",
    };

    try {
      const response = await this.requestWithRetries(boletoEndpoint, payload, {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/html",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
      });

      const boletoFilePath = await this.generateBoletoPDF(
        response,
        boletoData,
        customer,
        ticketQuantity,
        halfTickets,
        coupon
      );

      return {
        boletoUrl: response.linhaDigitavel,
        qrCodePix: response.qrCode?.url,
        numeroBoleto: response.numero,
        boletoFile: boletoFilePath,
      };
    } catch (error) {
      console.error("Erro na requisição Boleto:", {
        status: error.response?.status,
        data: JSON.stringify(error.response?.data, null, 2),
        headers: error.response?.headers,
        message: error.message,
        code: error.code,
      });
      throw error;
    }
  }

  async generateBoletoPDF(
    response,
    boletoData,
    customer,
    ticketQuantity,
    halfTickets,
    coupon
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
      .replace(
        /{{BENEFICIARIO_ENDERECO}}/g,
        `${response.beneficiario?.logradouro || ""}, ${
          response.beneficiario?.bairro || ""
        }, ${response.beneficiario?.cidade || ""} - ${
          response.beneficiario?.uf || ""
        }, CEP: ${response.beneficiario?.cep || ""}`
      )
      .replace(
        /{{AGENCIA_CONTA}}/g,
        `${response.beneficiario?.agencia || ""}-${
          response.beneficiario?.indicadorComprovacao || ""
        } / ${response.beneficiario?.contaCorrente || ""}`
      )
      .replace(/{{NOSSO_NUMERO}}/g, response.numero || "Não disponível")
      .replace(
        /{{QUANTIDADE}}/g,
        ticketQuantity ? ticketQuantity.toString() : "1"
      )
      .replace(
        /{{PAGADOR_NOME}}/g,
        customer.Name.toUpperCase() || "Não disponível"
      )
      .replace(
        /{{PAGADOR_CPF}}/g,
        customer.Identity.replace(
          /(\d{3})(\d{3})(\d{3})(\d{2})/,
          "$1.$2.$3-$4"
        ) || "Não disponível"
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
      .replace(/{{CARTEIRA}}/g, response.numeroCarteira?.toString() || "17")
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
      .replace(/{{TOTAL}}/g, calculation.total);

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: "/usr/lib64/chromium-browser/chromium-browser",
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
