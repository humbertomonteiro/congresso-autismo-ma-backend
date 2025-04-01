// src/controllers/PaymentController.js
const CheckoutService = require("../services/CheckoutService");
const CieloService = require("../services/CieloService");
const BancoDoBrasilService = require("../services/BancoDoBrasilService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const fs = require("fs");
const path = require("path");

const processCreditPayment = async (req, res) => {
  const {
    ticketQuantity,
    halfTickets,
    coupon,
    participants,
    creditCardData,
    payer,
  } = req.body;

  try {
    // Validações
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateCreditCard(creditCardData);
    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    // Processar pagamento com cartão
    const result = await CieloService.processCreditPayment(
      ticketQuantity,
      halfTickets,
      coupon,
      participants,
      creditCardData,
      totals,
      payer
    );

    res.sendResponse(200, true, result.message, {
      paymentId: result.paymentId,
      checkoutId: result.checkoutId,
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

// Mantidos intactos do código novo (funcionando com Banco do Brasil)
const processPixPayment = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon, participants } = req.body;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    const pixResponse = await BancoDoBrasilService.createPixPayment(
      totals.totalInCents,
      { Name: participants[0].name, Identity: participants[0].document }
    );

    res.sendResponse(
      200,
      true,
      "Pix gerado com sucesso, aguardando pagamento",
      {
        checkoutId: pixResponse.checkoutId,
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
  const { ticketQuantity, halfTickets, coupon, participants, payer } = req.body;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateBoleto(payer);
    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    if (!payer.document) {
      throw new Error("Documento do pagador é obrigatório.");
    }

    const boletoResponse = await BancoDoBrasilService.createBoletoPayment(
      totals.totalInCents,
      { Name: payer.name, Identity: payer.document },
      payer,
      ticketQuantity,
      halfTickets,
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
  const { coupon, ticketQuantity } = req.body;

  try {
    CheckoutService.calculateTotal(ticketQuantity, 0, coupon);
    res.sendResponse(200, true, "Cupom válido", { valid: true });
  } catch (error) {
    res.sendResponse(400, false, error.message, { valid: false });
  }
};

const calculateTotals = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon } = req.body;

  try {
    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
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
};
