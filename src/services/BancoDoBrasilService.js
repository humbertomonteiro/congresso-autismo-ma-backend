// src/services/BancoDoBrasilService.js
const axios = require("axios");
const https = require("https");
const config = require("../config");
const CheckoutService = require("./CheckoutService");
const { generateBoletoPDF } = require("../utils/templateUtils");

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
        if (error.response) {
          console.error(
            "Resposta da API:",
            JSON.stringify(error.response.data, null, 2)
          );
        }
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

  async getPixStatus(txId) {
    const token = await this.getAccessToken();
    const pixStatusEndpoint = `${this.apiBaseUrl}/pix/v2/cob/${txId}?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;
    console.log("[BB Service] Consultando status do Pix:", pixStatusEndpoint);

    const response = await axios.get(pixStatusEndpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: this.agent,
    });

    console.log("[BB Service] Resposta do status do Pix:", response.data);
    const statusMap = {
      ATIVA: "pending",
      CONCLUIDA: "approved",
      EXPIRADA: "error",
      REMOVIDA_PELO_USUARIO: "error",
    };
    return statusMap[response.data.status] || "error";
  }

  async createBoletoPayment(
    amount,
    customer,
    payer,
    ticketQuantity,
    halfTickets,
    coupon,
    participants
  ) {
    const token = await this.getAccessToken();
    const boletoEndpoint = `${this.apiBaseUrl}/boletos?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;
    console.log("Endpoint:", boletoEndpoint);
    console.log("Token:", token);
    console.log("Customer:", customer); // Depuração
    console.log("Payer:", payer);

    const numeroControle = Date.now().toString().slice(-10).padStart(10, "0");
    const numeroTituloCliente = `000${config.bancoDoBrasil.numeroConvenio}${numeroControle}`;
    const cepSemHifen = payer.zipCode.replace(/[^0-9]/g, "");

    const now = new Date();
    const offsetBrasil = -3 * 60;
    const today = new Date(now.getTime() + offsetBrasil * 60 * 1000);
    const cleanIdentity = customer.Identity.replace(/\D/g, "");
    const tipoInscricao = cleanIdentity.length === 11 ? 1 : 2;

    console.log("Data calculada (today):", today.toISOString());

    const payload = {
      numeroConvenio: parseInt(config.bancoDoBrasil.numeroConvenio),
      numeroCarteira: parseInt(config.bancoDoBrasil.numeroCarteira),
      numeroVariacaoCarteira: parseInt(
        config.bancoDoBrasil.numeroVariacaoCarteira
      ),
      codigoModalidade: 1,
      dataEmissao: this.formatDate(today),
      dataVencimento: this.formatDate(
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
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
        tipoInscricao: tipoInscricao,
        numeroInscricao: customer.Identity,
        nome: customer.Name.toUpperCase(),
        endereco: `${payer.street.toUpperCase()} N ${
          payer.addressNumber || ""
        }`,
        cep: cepSemHifen,
        cidade: payer.city.toUpperCase(),
        bairro: payer.district.toUpperCase(),
        uf: payer.state.toUpperCase(),
        telefone: payer.phone || "",
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

    const boletoFilePath = await generateBoletoPDF(
      response,
      payer,
      customer,
      ticketQuantity,
      halfTickets,
      coupon,
      participants,
      CheckoutService
    );

    return {
      boletoUrl: response.linhaDigitavel,
      qrCodePix: response.qrCode?.url,
      numeroBoleto: response.numero,
      boletoFile: boletoFilePath,
      dataVencimento: new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  }

  async getBoletoStatus(numeroBoleto) {
    const token = await this.getAccessToken();
    const boletoStatusEndpoint = `${this.apiBaseUrl}/boletos/${numeroBoleto}?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}&numeroConvenio=${config.bancoDoBrasil.numeroConvenio}`;
    console.log(
      "[BB Service] Consultando status do boleto:",
      boletoStatusEndpoint
    );
    console.log("[BB Service] Token usado:", token);

    try {
      const response = await axios.get(boletoStatusEndpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        httpsAgent: this.agent,
      });

      console.log("[BB Service] Resposta do status do boleto:", response.data);
      const statusMap = {
        1: "pending",
        6: "approved",
        5: "error",
        8: "error",
      };
      return statusMap[response.data.codigoEstadoTituloCobranca] || "error";
    } catch (error) {
      console.error("[BB Service] Erro ao consultar boleto:", {
        status: error.response?.status,
        data: JSON.stringify(error.response?.data, null, 2),
        message: error.message,
      });
      throw error;
    }
  }
}

module.exports = new BancoDoBrasilService();
