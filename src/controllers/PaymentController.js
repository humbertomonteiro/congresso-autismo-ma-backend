// src/controllers/PaymentController.js
const CheckoutService = require("../services/CheckoutService");
const CieloService = require("../services/CieloService");
const BancoDoBrasilService = require("../services/BancoDoBrasilService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const { generateBoletoPDF } = require("../utils/templateUtils");
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
    const bbDetail = error.response?.data?.detail || error.response?.data?.message;
    const userMessage = bbDetail || error.message;
    console.error("Erro ao processar Pix:", userMessage);
    res.sendResponse(500, false, "Erro ao gerar Pix", null, userMessage);
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

    // PDF é opcional — se não foi gerado, o cliente ainda pode pagar pela
    // linha digitável ou QR code PIX exibidos na página de confirmação.
    let boletoUrl = null;
    if (boletoResponse.boletoFile && fs.existsSync(boletoResponse.boletoFile)) {
      const boletoFileName = path.basename(boletoResponse.boletoFile);
      boletoUrl = `${req.protocol}://${req.get("host")}/boletos/${boletoFileName}`;
    }

    res.status(200).json({
      success: true,
      paymentId: boletoResponse.numeroBoleto,
      checkoutId: boletoResponse.checkoutId,
      boletoUrl,                           // null se o PDF não foi gerado
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
  if (process.env.NODE_ENV !== "production") {
    return res.sendResponse(200, true, "Sandbox — verificação de boletos ignorada");
  }
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

    const isCourtesy = checkoutData.paymentDetails?.courtesy === true ||
      checkoutData.paymentDetails?.paymentMethod === "courtesy";

    const checkoutId = await CheckoutRepository.saveCheckout({ ...checkoutData, status, isCourtesy });

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

const downloadBoletoPDF = async (req, res) => {
  const { checkoutId } = req.params;

  try {
    const checkout = await CheckoutRepository.getCheckoutById(checkoutId);
    const boleto = checkout.paymentDetails?.boleto;

    if (!boleto) {
      return res.status(404).json({ error: "Boleto não encontrado para este checkout." });
    }

    // Serve o arquivo existente se ainda estiver no disco
    if (boleto.pdfFilePath && fs.existsSync(boleto.pdfFilePath)) {
      return res.download(boleto.pdfFilePath, `boleto_${boleto.numeroBoleto}.pdf`);
    }

    // Reconstrói o response a partir dos dados salvos no Firestore
    const fakeResponse = {
      numero: boleto.numeroBoleto,
      linhaDigitavel: boleto.linhaDigitavel || "",
      codigoBarraNumerico: boleto.codigoBarraNumerico || "00000000000000000000000000000000000000000000",
      qrCodeEmv: boleto.qrCodeEmv || null,
      qrCode: boleto.qrCodeEmv ? { emv: boleto.qrCodeEmv } : null,
    };

    const customer = {
      Name: checkout.buyerName || "",
      Identity: checkout.buyerCpf || "",
      IdentityType: (checkout.buyerCpf || "").replace(/\D/g, "").length === 11 ? "cpf" : "cnpj",
    };

    const payer = checkout.payerAddress || {};
    const { allTickets = 0, halfTickets = 0, socialTickets = 0, coupon } = checkout.orderDetails || {};
    const ticketQuantity = allTickets + halfTickets + socialTickets;

    const participants = await CheckoutRepository.getParticipantsByCheckout(checkoutId);

    // dataVencimento pode ser "DD.MM.YYYY" — converte para Date
    let dataVencimentoDate = new Date();
    if (boleto.dataVencimento) {
      const parts = boleto.dataVencimento.split(".");
      if (parts.length === 3) {
        dataVencimentoDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    }

    const pdfPath = await generateBoletoPDF(
      fakeResponse,
      payer,
      customer,
      ticketQuantity,
      halfTickets,
      socialTickets,
      coupon || null,
      participants.map((p) => ({ name: p.name })),
      dataVencimentoDate
    );

    // Atualiza o caminho no Firestore para próximos downloads enquanto o arquivo existir
    await CheckoutRepository.updateCheckout(checkoutId, {
      "paymentDetails.boleto.pdfFilePath": pdfPath,
    });

    res.download(pdfPath, `boleto_${boleto.numeroBoleto}.pdf`);
  } catch (error) {
    console.error("[PaymentController] Erro ao baixar boleto PDF:", error.message);
    res.status(500).json({ error: "Erro ao gerar o PDF do boleto. Tente novamente." });
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
  downloadBoletoPDF,
};
