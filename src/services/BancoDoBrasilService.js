const axios = require("axios");
const https = require("https");
const config = require("../config");
const CheckoutService = require("./CheckoutService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const { generateBoletoPDF } = require("../utils/templateUtils");

const { format, addDays } = require("date-fns");
const { toZonedTime } = require("date-fns-tz");

class BancoDoBrasilService {
  constructor() {
    this.authBaseUrl = config.bancoDoBrasil.authBaseUrl;
    this.apiBaseUrl = config.bancoDoBrasil.baseUrl;
    this.agent = new https.Agent({
      rejectUnauthorized: false,
      // pfx: fs.readFileSync(config.bancoDoBrasil.certificadoPfx),
      // passphrase: config.bancoDoBrasil.certificadoSenha,
    });
    this.basePrice = 499;
    this.halfPrice = 399;
  }

  formatDate(date) {
    return format(date, "dd.MM.yyyy");
  }

  calculateTotal(ticketQuantity, halfTickets, coupon) {
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
    const valueTicketsAll = fullTickets * this.basePrice;
    const valueTicketsHalf = halfTickets * this.halfPrice;
    let discount = 0;

    if (coupon === "grupo" && ticketQuantity >= 5) {
      discount = (ticketQuantity - halfTickets) * 50;
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
    const CheckoutRepository = require("../repositories/CheckoutRepository"); // Importa aqui

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

    // Prepara o checkoutData
    const checkoutData = {
      transactionId: txId,
      timestamp: new Date().toISOString(),
      status: "pending",
      paymentMethod: "pix",
      totalAmount: (amount / 100).toFixed(2),
      eventName: "Congresso Autismo MA 2025",
      participants: [{ name: customer.Name, document: customer.Identity }], // Ajuste se vier do frontend
      paymentId: response.txid,
      orderDetails: {
        ticketQuantity: 1, // Ajuste conforme dados reais
        fullTickets: 1,
        halfTickets: 0,
        valueTicketsAll: (amount / 100).toFixed(2),
        valueTicketsHalf: "0.00",
        discount: "0.00",
        total: (amount / 100).toFixed(2),
      },
      paymentDetails: {
        pix: {
          qrCodeString: response.qrcode.qrCode,
          qrCodeLink: response.qrcode.linkVisualizacao,
          expirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      },
      document: customer.Identity || "",
      sentEmails: [],
      pendingEmails: [],
      qrCodesSent: false,
    };

    // Salva o checkout
    const checkoutId = await CheckoutRepository.saveCheckout(checkoutData);

    // Associa templates ao criar
    await CheckoutRepository.addAllTemplatesToPendingEmails(
      checkoutId,
      checkoutData.status
    );

    return {
      checkoutId, // Retorna o checkoutId
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
    let boletoResponse;
    try {
      const token = await this.getAccessToken();
      const boletoEndpoint = `${this.apiBaseUrl}/boletos?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;
      const numeroControle = Date.now().toString().slice(-10).padStart(10, "0");
      const numeroTituloCliente = `000${config.bancoDoBrasil.numeroConvenio}${numeroControle}`;
      const cepSemHifen = payer.zipCode.replace(/[^0-9]/g, "");

      const now = new Date();
      const today = toZonedTime(now, "America/Sao_Paulo");
      const cleanIdentity = customer.Identity.replace(/\D/g, "");
      const tipoInscricao = cleanIdentity.length === 11 ? 1 : 2;

      const payload = {
        numeroConvenio: parseInt(config.bancoDoBrasil.numeroConvenio),
        numeroCarteira: parseInt(config.bancoDoBrasil.numeroCarteira),
        numeroVariacaoCarteira: parseInt(
          config.bancoDoBrasil.numeroVariacaoCarteira
        ),
        codigoModalidade: 1,
        dataEmissao: this.formatDate(today),
        dataVencimento: this.formatDate(addDays(today, 3)),
        valorOriginal: (amount / 100).toFixed(2),
        valorAbatimento: 0,
        indicadorAceiteTituloVencido: "N",
        codigoAceite: "A",
        codigoTipoTitulo: "02",
        descricaoTipoTitulo: "DM",
        indicadorPermissaoRecebimentoParcial: "S",
        numeroTituloBeneficiario: `0${cleanIdentity.slice(0, 4)}-DSD-1`,
        textoCampoUtilizacaoBeneficiario: "CONGRESSOAUTISMOMA2025",
        numeroTituloCliente: numeroTituloCliente,
        desconto: { tipo: 0 },
        jurosMora: { tipo: 1, valor: 1.0, porcentagem: 0 },
        multa: { tipo: 0, dados: "", porcentagem: 0, valor: 0 },
        pagador: {
          tipoInscricao,
          numeroInscricao: cleanIdentity,
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

      boletoResponse = await this.requestWithRetries(boletoEndpoint, payload, {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      });

      const boletoFilePath = await generateBoletoPDF(
        boletoResponse,
        payer,
        customer,
        ticketQuantity,
        halfTickets,
        coupon,
        participants,
        CheckoutService
      );

      const totals = this.calculateTotal(ticketQuantity, halfTickets, coupon);

      const checkoutData = {
        transactionId: numeroTituloCliente,
        timestamp: today.toISOString(),
        status: "pending",
        paymentMethod: "boleto",
        totalAmount: totals.total,
        eventName: "Congresso Autismo MA 2025",
        participants,
        paymentId: boletoResponse.numero,
        orderDetails: {
          ...totals,
          ticketQuantity,
          fullTickets: ticketQuantity - halfTickets,
          halfTickets,
          coupon: coupon || null,
        },
        paymentDetails: {
          boleto: {
            boletoUrl: boletoResponse.linhaDigitavel,
            qrCodePix: boletoResponse.qrCode?.url,
            address: payer,
            pdfFilePath: boletoFilePath,
            dataVencimento: addDays(today, 3).toISOString(),
          },
        },
        document: customer.Identity || "",
        sentEmails: [],
        pendingEmails: [],
        qrCodesSent: false,
      };

      const checkoutId = await CheckoutRepository.saveCheckout(checkoutData);
      await CheckoutRepository.addAllTemplatesToPendingEmails(
        checkoutId,
        checkoutData.status
      );

      return {
        checkoutId,
        boletoUrl: boletoResponse.linhaDigitavel,
        qrCodePix: boletoResponse.qrCode?.url,
        numeroBoleto: boletoResponse.numero,
        boletoFile: boletoFilePath,
        dataVencimento: addDays(today, 3).toISOString(),
      };
    } catch (error) {
      console.error(
        "Erro ao criar boleto no BancoDoBrasilService:",
        error.message
      );

      const totals = this.calculateTotal(ticketQuantity, halfTickets, coupon);
      const errorCheckoutData = {
        transactionId: numeroTituloCliente || `ORDER_${Date.now()}`,
        timestamp: today.toISOString(),
        status: "error",
        paymentMethod: "boleto",
        totalAmount: totals?.total || "0.00",
        eventName: "Congresso Autismo MA 2025",
        participants: participants || [],
        paymentId: boletoResponse?.numero || null,
        orderDetails: totals
          ? {
              ...totals,
              ticketQuantity,
              fullTickets: ticketQuantity - halfTickets,
              halfTickets,
              coupon: coupon || null,
            }
          : {
              ticketQuantity,
              fullTickets: ticketQuantity - halfTickets,
              halfTickets,
              coupon: coupon || null,
              total: "0.00",
              totalInCents: 0,
            },
        paymentDetails: {
          boleto: boletoResponse
            ? {
                boletoUrl: boletoResponse.linhaDigitavel,
                qrCodePix: boletoResponse.qrCode?.url,
                address: payer,
                pdfFilePath: null,
                dataVencimento: addDays(today, 3).toISOString(),
              }
            : null,
        },
        document: customer.Identity || "",
        sentEmails: [],
        errorLog: error.message,
        qrCodesSent: false,
      };

      const checkoutId = await CheckoutRepository.saveCheckout(
        errorCheckoutData
      );
      await CheckoutRepository.addAllTemplatesToPendingEmails(
        checkoutId,
        errorCheckoutData.status
      );

      throw error;
    }
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
