const axios = require("axios");
const https = require("https");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const { buildParticipantsBatch } = require("../utils/normalizeParticipant");
const { generateBoletoPDF } = require("../utils/templateUtils");
const { format, addDays } = require("date-fns");
const { toZonedTime } = require("date-fns-tz");
const config = require("../config");
const logger = require("../logger");

const CONFIG_DOC = config.firebase.db.doc("config/eventConfig");
const DEFAULT_PRICES = { full: 499.9, half: 399.9, social: 199.9 };
const DEFAULT_EVENT_NAME = config.event.name;

async function getEventFirestoreConfig() {
  try {
    const snap = await CONFIG_DOC.get();
    if (snap.exists) {
      const data = snap.data();
      const p = data.ticketPrices || {};
      return {
        prices: {
          full: p.full ?? DEFAULT_PRICES.full,
          half: p.half ?? DEFAULT_PRICES.half,
          social: p.social ?? DEFAULT_PRICES.social,
        },
        eventName: data.eventName || DEFAULT_EVENT_NAME,
      };
    }
  } catch (_) {
    /* fall through */
  }
  return { prices: DEFAULT_PRICES, eventName: DEFAULT_EVENT_NAME };
}

// Códigos de estado do boleto BB:
// 1 = Normal (em aberto/pendente)
// 2 = Movimento Cartório (protestado)
// 3 = Em Cartório
// 4 = Título Pago
// 5 = Baixado
// 6 = Liquidado (pago)
// 7 = Liquidado por Conta
// 8 = Liquidado via Cartório
// 9 = Liquidado por Saldo
const BOLETO_STATUS_MAP = {
  1: "pending", // Normal — aguardando pagamento
  2: "pending", // Em cartório — ainda pode pagar
  3: "pending", // Em cartório
  4: "approved", // Pago
  5: "expired", // Baixado
  6: "approved", // Liquidado
  7: "approved", // Liquidado por conta
  8: "approved", // Liquidado via cartório
  9: "approved", // Liquidado por saldo
};

class BancoDoBrasilService {
  constructor() {
    this.authBaseUrl = config.bancoDoBrasil.authBaseUrl;
    this.apiBaseUrl = config.bancoDoBrasil.baseUrl;
    this.pixBaseUrl = config.bancoDoBrasil.pixBaseUrl;
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) {
      date = toZonedTime(new Date(), "America/Sao_Paulo");
    }
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
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

  // Token específico para a API PIX (scopes diferentes dos do boleto)
  async getPixAccessToken() {
    const auth = Buffer.from(
      `${config.bancoDoBrasil.clientId}:${config.bancoDoBrasil.clientSecret}`
    ).toString("base64");

    const response = await axios.post(
      `${this.authBaseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "cob.write cob.read",
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

  async requestWithRetries(url, payload, headers, retries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers,
          httpsAgent: this.agent,
          timeout: 15000,
        });
        return response.data;
      } catch (error) {
        logger.error(`[BB] Tentativa ${attempt} falhou: ${error.message}`);
        if (error.response) {
          logger.error(`[BB] Resposta: ${JSON.stringify(error.response.data)}`);
        }
        if (attempt === retries) throw error;
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }

  async createBoletoPayment(
    amount,
    customer,
    payer,
    allTickets,
    halfTickets,
    socialTickets,
    coupon,
    participants
  ) {
    const ticketQuantity = allTickets + halfTickets + socialTickets;
    const { prices, eventName: EVENT_NAME } = await getEventFirestoreConfig();
    const {
      full: ALL_TICKET_VALUE,
      half: HALF_TICKET_VALUE,
      social: SOCIAL_TICKET_VALUE,
    } = prices;
    const token = await this.getAccessToken();
    const boletoEndpoint = `${this.apiBaseUrl}/boletos?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;

    const now = toZonedTime(new Date(), "America/Sao_Paulo");
    const hour = now.getHours();
    // Após 21h o BB não aceita boleto para o mesmo dia — vence amanhã
    const dataVencimentoDate = hour >= 21 ? addDays(now, 4) : addDays(now, 3);
    const dataVencimento = this.formatDate(dataVencimentoDate);
    const dataEmissao = this.formatDate(now);

    const numeroControle = Date.now().toString().slice(-10).padStart(10, "0");
    const numeroTituloCliente = `000${config.bancoDoBrasil.numeroConvenio}${numeroControle}`;

    const cleanIdentity = customer.Identity.replace(/\D/g, "");
    const tipoInscricao = cleanIdentity.length === 11 ? 1 : 2;

    const payload = {
      numeroConvenio: parseInt(config.bancoDoBrasil.numeroConvenio),
      numeroCarteira: parseInt(config.bancoDoBrasil.numeroCarteira),
      numeroVariacaoCarteira: parseInt(
        config.bancoDoBrasil.numeroVariacaoCarteira
      ),
      codigoModalidade: 1,
      dataEmissao,
      dataVencimento,
      valorOriginal: (amount / 100).toFixed(2),
      valorAbatimento: 0,
      indicadorAceiteTituloVencido: "N",
      codigoAceite: "A",
      codigoTipoTitulo: "02",
      descricaoTipoTitulo: "DM",
      indicadorPermissaoRecebimentoParcial: "S",
      numeroTituloBeneficiario: `0${cleanIdentity.slice(0, 4)}-DSD-1`,
      textoCampoUtilizacaoBeneficiario: "CONGRESSOAUTISMOMA2026",
      numeroTituloCliente,
      desconto: { tipo: 0 },
      jurosMora: { tipo: 1, valor: 1.0, porcentagem: 0 },
      multa: { tipo: 0, dados: "", porcentagem: 0, valor: 0 },
      protesto: { tipo: 0 }, // sem protesto / sem cartório
      pagador: {
        tipoInscricao,
        numeroInscricao: cleanIdentity,
        nome: customer.Name.toUpperCase(),
      },
      indicadorPix: "S",
      textoEnderecoEmail: "saludcuidarmais@gmail.com",
    };

    const boletoResponse = await this.requestWithRetries(
      boletoEndpoint,
      payload,
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }
    );

    const numeroBoleto = boletoResponse.numero;

    // ── Salva o checkout ANTES de tentar gerar o PDF ──────────────────────────
    // Isso garante que o boleto não seja perdido mesmo se o PDF falhar.
    const checkoutData = {
      status: "pending",
      paymentMethod: "boleto",
      paymentId: numeroBoleto,
      buyerName: customer.Name,
      buyerCpf: cleanIdentity,
      eventName: EVENT_NAME,
      payerAddress: payer || null,
      orderDetails: {
        allTickets,
        halfTickets,
        socialTickets,
        coupon: coupon || null,
        total: (amount / 100).toFixed(2),
        valueTicketsAll: (allTickets * ALL_TICKET_VALUE).toFixed(2),
        valueTicketsHalf: (halfTickets * HALF_TICKET_VALUE).toFixed(2),
        valueTicketsSocial: (socialTickets * SOCIAL_TICKET_VALUE).toFixed(2),
        discount: "0.00",
      },
      paymentDetails: {
        boleto: {
          numeroBoleto,
          numeroBoletoBancario: boletoResponse.numeroBoletoBancario || null,
          linhaDigitavel: boletoResponse.linhaDigitavel || null,
          codigoBarraNumerico: boletoResponse.codigoBarraNumerico || null,
          qrCodeEmv: boletoResponse.qrCode?.emv || null,
          qrCodePix:
            boletoResponse.qrCode?.url || boletoResponse.qrCode?.emv || null,
          dataVencimento,
          pdfFilePath: null, // preenchido abaixo se a geração for bem-sucedida
        },
      },
    };

    const checkoutId = await CheckoutRepository.saveCheckout(checkoutData);

    // ── Gera o PDF após salvar (falha aqui não compromete o checkout) ─────────
    let boletoFilePath = null;
    try {
      boletoFilePath = await generateBoletoPDF(
        boletoResponse,
        payer,
        customer,
        ticketQuantity,
        halfTickets,
        socialTickets,
        coupon,
        participants,
        dataVencimentoDate
      );
      // Atualiza o caminho do PDF no checkout já salvo
      await CheckoutRepository.updateCheckout(checkoutId, {
        "paymentDetails.boleto.pdfFilePath": boletoFilePath,
      });
    } catch (pdfErr) {
      logger.warn(
        `[BB] PDF do boleto não gerado (checkout ${checkoutId} salvo): ${pdfErr.message}`
      );
    }

    // DEPOIS
    const CredentialService = require("./CredentialService");

    const participantsData = buildParticipantsBatch(participants, {
      checkoutId,
      allTickets,
      halfTickets,
    });
    const participantIds = await CheckoutRepository.saveParticipants(
      checkoutId,
      participantsData
    );

    // ✅ Gera qrToken para cada participante imediatamente após salvar
    for (let i = 0; i < participantIds.length; i++) {
      await CredentialService.generateQRCodesForParticipant(
        checkoutId,
        participantIds[i],
        participants[i].name
      );
    }

    logger.info(
      `[BB] Boleto criado — checkout: ${checkoutId}, numero: ${numeroBoleto}`
    );

    return {
      checkoutId,
      numeroBoleto,
      boletoUrl: boletoResponse.linhaDigitavel,
      qrCodePix: boletoResponse.qrCode?.url || null,
      boletoFile: boletoFilePath,
    };
  }

  async createPixPayment(
    amount,
    allTickets,
    halfTickets,
    socialTickets,
    coupon,
    participants
  ) {
    const ticketQuantity = allTickets + halfTickets + socialTickets;
    const { prices, eventName: EVENT_NAME } = await getEventFirestoreConfig();
    const {
      full: ALL_TICKET_VALUE,
      half: HALF_TICKET_VALUE,
      social: SOCIAL_TICKET_VALUE,
    } = prices;
    const token = await this.getPixAccessToken();
    const pixEndpoint = `${this.pixBaseUrl}/cob?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;

    const payer = participants[0];
    const cleanIdentity = payer.document.replace(/\D/g, "");
    const isCnpj = cleanIdentity.length === 14;

    const pixKey = config.bancoDoBrasil.pixKey;
    if (!pixKey) {
      throw new Error(
        "Chave PIX não configurada. Defina BB_PIX_KEY_PRODUCTION ou BB_PIX_KEY_SANDBOX no .env."
      );
    }

    const payload = {
      calendario: { expiracao: 3600 },
      devedor: isCnpj
        ? { cnpj: cleanIdentity, nome: payer.name }
        : { cpf: cleanIdentity, nome: payer.name },
      valor: {
        original: (amount / 100).toFixed(2),
      },
      chave: pixKey,
      solicitacaoPagador: `Pagamento ${EVENT_NAME}`,
      infoAdicionais: [{ nome: "Evento", valor: EVENT_NAME }],
    };

    const response = await this.requestWithRetries(pixEndpoint, payload, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    const expirationDate = new Date(Date.now() + 3600 * 1000).toISOString();

    const checkoutData = {
      status: "pending",
      paymentMethod: "pix",
      paymentId: response.txid,
      buyerName: payer.name,
      buyerCpf: cleanIdentity,
      eventName: EVENT_NAME,
      orderDetails: {
        allTickets,
        halfTickets,
        socialTickets,
        coupon: coupon || null,
        total: (amount / 100).toFixed(2),
        valueTicketsAll: (allTickets * ALL_TICKET_VALUE).toFixed(2),
        valueTicketsHalf: (halfTickets * HALF_TICKET_VALUE).toFixed(2),
        valueTicketsSocial: (socialTickets * SOCIAL_TICKET_VALUE).toFixed(2),
        discount: "0.00",
      },
      paymentDetails: {
        pix: {
          txId: response.txid,
          qrCode: response.pixCopiaECola || null,
          qrCodeLink: response.location || null,
          expirationDate,
        },
      },
    };

    const checkoutId = await CheckoutRepository.saveCheckout(checkoutData);

    const participantsData = buildParticipantsBatch(participants, {
      checkoutId,
      allTickets,
      halfTickets,
    });
    const participantIds = await CheckoutRepository.saveParticipants(
      checkoutId,
      participantsData
    );

    logger.info(
      `[BB] PIX criado — checkout: ${checkoutId}, txId: ${response.txid}`
    );

    return {
      checkoutId,
      participantIds,
      txId: response.txid,
      qrCode: response.pixCopiaECola || null,
      qrCodeLink: response.location || null,
      expirationDate,
    };
  }

  // ── Verificação de status ─────────────────────────────────────────────────

  async getBoletoStatus(numeroBoleto) {
    const token = await this.getAccessToken();

    // Endpoint correto para consulta por nosso número (numero interno)
    const endpoint = `${this.apiBaseUrl}/boletos/${numeroBoleto}?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}&numeroConvenio=${config.bancoDoBrasil.numeroConvenio}`;

    try {
      const response = await axios.get(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        httpsAgent: this.agent,
        timeout: 15000,
      });

      const codigo = response.data.codigoEstadoTituloCobranca;
      const status = BOLETO_STATUS_MAP[codigo] || "pending";

      logger.info(
        `[BB] Boleto ${numeroBoleto} — codigoEstado: ${codigo} → status: ${status} (${response.data.nomeSacadoCobranca})`
      );

      return status;
    } catch (error) {
      const httpStatus = error.response?.status;
      const errorData = error.response?.data;

      // 404 = boleto não encontrado no BB (número errado ou ainda não processado)
      if (httpStatus === 404) {
        logger.warn(
          `[BB] Boleto ${numeroBoleto} não encontrado (404) — mantendo como pending`
        );
        return "pending";
      }

      logger.error(
        `[BB] Erro ao consultar boleto ${numeroBoleto}: ${error.message}`
      );
      if (errorData) logger.error(`[BB] Detalhe: ${JSON.stringify(errorData)}`);
      throw error;
    }
  }

  async getPixStatus(txId) {
    const token = await this.getPixAccessToken();
    const endpoint = `${this.pixBaseUrl}/cob/${txId}?gw-dev-app-key=${config.bancoDoBrasil.developerApiKey}`;

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: this.agent,
    });

    const statusMap = {
      ATIVA: "pending",
      CONCLUIDA: "approved",
      REMOVIDA_PELO_USUARIO_RECEBEDOR: "expired",
      REMOVIDA_POR_EXPIRAÇÃO: "expired",
    };

    const status = statusMap[response.data.status] || "pending";
    logger.info(`[BB] Pix ${txId} → status: ${status}`);
    return status;
  }
}

module.exports = new BancoDoBrasilService();
