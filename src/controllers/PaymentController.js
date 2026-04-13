// src/controllers/PaymentController.js
const CheckoutService = require("../services/CheckoutService");
const CieloService = require("../services/CieloService");
const BancoDoBrasilService = require("../services/BancoDoBrasilService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const fs = require("fs");
const path = require("path");

const processCreditPayment = async (req, res) => {
  const {
    allTickets,
    halfTickets,
    socialTickets,
    coupon,
    participants,
    creditCardData,
    payer,
  } = req.body;

  const allT = parseInt(allTickets) || 0;
  const halfT = parseInt(halfTickets) || 0;
  const socialT = parseInt(socialTickets) || 0;
  const ticketQuantity = allT + halfT + socialT;

  try {
    // Validações
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateCreditCard(creditCardData);
    const totals = await CheckoutService.calculateTotal(allT, halfT, socialT, coupon);

    // Processar pagamento com cartão
    const result = await CieloService.processCreditPayment(
      allT,
      halfT,
      socialT,
      coupon,
      participants,
      creditCardData,
      totals,
      payer
    );

    res.sendResponse(200, true, result.message, {
      paymentId: result.paymentId,
      checkoutId: result.checkoutId,
      participantIds: result.participantIds,
      status: result.status,
      totalAmount: totals.total,
      transactionId: result.transactionId,
    });
  } catch (error) {
    console.error("Erro ao processar crédito:", error.message);
    res.sendResponse(
      500,
      false,
      "Erro ao processar pagamento com cartão",
      null,
      error.message
    );
  }
};

const processPixPayment = async (req, res) => {
  const { allTickets, halfTickets, socialTickets, coupon, participants } = req.body;

  const allT = parseInt(allTickets) || 0;
  const halfT = parseInt(halfTickets) || 0;
  const socialT = parseInt(socialTickets) || 0;
  const ticketQuantity = allT + halfT + socialT;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    const totals = await CheckoutService.calculateTotal(allT, halfT, socialT, coupon);

    const pixResponse = await BancoDoBrasilService.createPixPayment(
      totals.totalInCents,
      allT,
      halfT,
      socialT,
      coupon,
      participants
    );

    res.sendResponse(
      200,
      true,
      "Pix gerado com sucesso, aguardando pagamento",
      {
        checkoutId: pixResponse.checkoutId,
        participantIds: pixResponse.participantIds,
        paymentId: pixResponse.txId,
        qrCodeString: pixResponse.qrCode,
        qrCodeLink: pixResponse.qrCodeLink,
        expirationDate: pixResponse.expirationDate,
      }
    );
  } catch (error) {
    console.error("Erro ao processar Pix:", error.message);
    res.sendResponse(500, false, "Erro ao gerar Pix", null, error.message);
  }
};

const processBoletoPayment = async (req, res) => {
  const { allTickets, halfTickets, socialTickets, coupon, participants, payer } = req.body;

  const allT = parseInt(allTickets) || 0;
  const halfT = parseInt(halfTickets) || 0;
  const socialT = parseInt(socialTickets) || 0;
  const ticketQuantity = allT + halfT + socialT;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateBoleto(payer);
    const totals = await CheckoutService.calculateTotal(allT, halfT, socialT, coupon);

    if (!payer.document) {
      throw new Error("Documento do pagador é obrigatório.");
    }

    const boletoResponse = await BancoDoBrasilService.createBoletoPayment(
      totals.totalInCents,
      { Name: payer.name, Identity: payer.document },
      payer,
      allT,
      halfT,
      socialT,
      coupon,
      participants
    );

    if (!fs.existsSync(boletoResponse.boletoFile)) {
      throw new Error(
        `Arquivo PDF não encontrado: ${boletoResponse.boletoFile}`
      );
    }

    const boletoFileName = path.basename(boletoResponse.boletoFile);
    const boletoUrl = `${req.protocol}://${req.get(
      "host"
    )}/boletos/${boletoFileName}`;

    res.status(200).json({
      success: true,
      paymentId: boletoResponse.numeroBoleto,
      checkoutId: boletoResponse.checkoutId,
      boletoUrl: boletoUrl,
      linhaDigitavel: boletoResponse.boletoUrl,
      qrCodePix: boletoResponse.qrCodePix || null,
    });
  } catch (error) {
    console.error("Erro ao processar boleto:", error.message);
    res.sendResponse(500, false, "Erro ao gerar boleto", null, error.message);
  }
};

const validateCoupon = async (req, res) => {
  const { coupon, allTickets } = req.body;
  const allT = parseInt(allTickets) || 1;

  try {
    await CheckoutService.calculateTotal(allT, 0, 0, coupon);
    res.sendResponse(200, true, "Cupom válido", { valid: true });
  } catch (error) {
    res.sendResponse(400, false, error.message, { valid: false });
  }
};

const calculateTotals = async (req, res) => {
  const { allTickets, halfTickets, socialTickets, coupon } = req.body;

  const allT = parseInt(allTickets) || 0;
  const halfT = parseInt(halfTickets) || 0;
  const socialT = parseInt(socialTickets) || 0;

  try {
    const totals = await CheckoutService.calculateTotal(allT, halfT, socialT, coupon);
    res.sendResponse(200, true, "Totais calculados com sucesso", totals);
  } catch (error) {
    res.sendResponse(
      400,
      false,
      "Erro ao calcular totais",
      null,
      error.message
    );
  }
};

const fetchCieloSales = async (req, res) => {
  try {
    const sales = await CieloService.fetchCieloSales();
    await CheckoutRepository.saveCieloSales(sales);
    res.sendResponse(200, true, "Vendas da Cielo importadas com sucesso");
  } catch (error) {
    console.error("Erro ao buscar vendas da Cielo:", error.message);
    res.sendResponse(
      500,
      false,
      "Erro ao importar vendas da Cielo",
      null,
      error.message
    );
  }
};

const verifyPayment = async (req, res) => {
  const { paymentId } = req.params;
  try {
    const result = await CheckoutService.verifyPaymentById(paymentId);
    if (result.status === "not_found") {
      return res.sendResponse(
        404,
        false,
        "Pagamento não encontrado ou não está pendente"
      );
    }
    res.sendResponse(200, true, "Status do pagamento verificado", result);
  } catch (error) {
    console.error(
      `[PaymentController] Erro ao verificar pagamento ${paymentId}:`,
      error.message
    );
    res.sendResponse(
      500,
      false,
      "Erro ao verificar pagamento",
      null,
      error.message
    );
  }
};

const verifyAllPayments = async (req, res) => {
  try {
    await CheckoutService.verifyAllPendingPayments();
    res.sendResponse(
      200,
      true,
      "Verificação de todos os pagamentos pendentes concluída"
    );
  } catch (error) {
    console.error(
      "[PaymentController] Erro ao verificar todos os pendentes:",
      error.message
    );
    res.sendResponse(
      500,
      false,
      "Erro ao verificar pagamentos pendentes",
      null,
      error.message
    );
  }
};

const addAllTemplatesToPendingEmails = async (req, res) => {
  try {
    const { checkoutId, status } = req.body;
    const result = await CheckoutRepository.addAllTemplatesToPendingEmails(
      checkoutId,
      status
    );

    res.sendResponse(
      200,
      true,
      "Templates adicionados à fila de e-mails pendentes",
      result
    );
  } catch (error) {
    console.error(
      "[PaymentController] Erro ao adicionar templates à fila de e-mails:",
      error.message
    );
    res.sendResponse(
      500,
      false,
      "Erro ao adicionar templates à fila de e-mails",
      null,
      error.message
    );
  }
};

const createManualCheckout = async (req, res) => {
  // eslint-disable-next-line no-unused-vars
  const { participants, status: _ignoredStatus, ...checkoutData } = req.body;

  // O status é determinado pelo backend com base na role real do usuário,
  // nunca pelo valor enviado pelo frontend.
  // adm / suporte → aprovado imediatamente
  // vendedor      → pendente até aprovação manual do admin
  const role = req.userRole; // anexado pelo middleware requireManualCheckoutAccess
  const status = role === "vendedor" ? "pending" : "approved";

  try {
    const { buildParticipantsBatch } = require("../utils/normalizeParticipant");
    const CredentialService = require("../services/CredentialService");
    const CampaignService = require("../services/CampaignService");

    const checkoutId = await CheckoutRepository.saveCheckout({ ...checkoutData, status });

    const allTickets = checkoutData.orderDetails?.allTickets ?? 0;
    const halfTickets = checkoutData.orderDetails?.halfTickets ?? 0;

    const participantsData = buildParticipantsBatch(participants, {
      checkoutId,
      allTickets,
      halfTickets,
    });

    const participantIds = await CheckoutRepository.saveParticipants(
      checkoutId,
      participantsData
    );

    for (let i = 0; i < participantIds.length; i++) {
      await CredentialService.generateQRCodesForParticipant(
        checkoutId,
        participantIds[i],
        participants[i].name
      );
    }

    await CampaignService.triggerForCheckout({ id: checkoutId, ...checkoutData, status });

    res.sendResponse(200, true, "Checkout manual criado com sucesso", {
      checkoutId,
      participantIds,
    });
  } catch (error) {
    console.error("[PaymentController] Erro ao criar checkout manual:", error.message);
    res.sendResponse(
      500,
      false,
      "Erro ao criar checkout manual",
      null,
      error.message
    );
  }
};

module.exports = {
  processCreditPayment,
  processPixPayment,
  processBoletoPayment,
  validateCoupon,
  calculateTotals,
  fetchCieloSales,
  verifyPayment,
  verifyAllPayments,
  addAllTemplatesToPendingEmails,
  createManualCheckout,
};
