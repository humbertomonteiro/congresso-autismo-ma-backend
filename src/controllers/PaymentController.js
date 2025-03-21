// src/controllers/PaymentController.js
const CheckoutService = require("../services/CheckoutService");
const CieloService = require("../services/CieloService");
const BancoDoBrasilService = require("../services/BancoDoBrasilService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const fs = require("fs");

const processCreditPayment = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon, participants, creditCardData } =
    req.body;

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
      totals
    );

    res.sendResponse(200, true, result.message, {
      paymentId: result.paymentId,
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

    const paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: participants[0].name,
        Identity: participants[0].document.replace(/\D/g, ""),
        IdentityType: participants[0].documentType,
      },
      Amount: totals.totalInCents,
    };

    const pixResponse = await BancoDoBrasilService.createPixPayment(
      paymentData.Amount,
      paymentData.Customer
    );

    const checkoutData = {
      transactionId: paymentData.MerchantOrderId,
      timestamp: new Date().toISOString(),
      status: "pending",
      paymentMethod: "pix",
      totalAmount: totals.total,
      eventName: "Congresso Autismo MA 2025",
      participants,
      paymentId: pixResponse.txId,
      orderDetails: {
        ...totals,
        ticketQuantity,
        fullTickets: ticketQuantity - halfTickets,
        halfTickets,
        coupon: coupon || null,
      },
      paymentDetails: {
        pix: {
          qrCodeString: pixResponse.qrCode,
          qrCodeLink: pixResponse.qrCodeLink,
          expirationDate: pixResponse.expirationDate,
        },
      },
      sentEmails: [],
    };

    await CheckoutRepository.saveCheckout(checkoutData);

    res.sendResponse(
      200,
      true,
      "Pix gerado com sucesso, aguardando pagamento",
      {
        paymentId: pixResponse.txId,
        qrCodeString: pixResponse.qrCode,
        qrCodeLink: pixResponse.qrCodeLink,
        expirationDate: pixResponse.expirationDate,
      }
    );
  } catch (error) {
    console.error("Erro ao processar Pix:", error.message);

    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
    const errorCheckoutData = {
      transactionId: `ORDER_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: "error",
      paymentMethod: "pix",
      totalAmount: totals?.total || "0.00",
      eventName: "Congresso Autismo MA 2025",
      participants: participants || [],
      paymentId: null,
      orderDetails: {
        ticketQuantity,
        fullTickets: ticketQuantity - halfTickets,
        halfTickets,
        coupon: coupon || null,
        valueTicketsAll: totals?.valueTicketsAll || "0.00",
        valueTicketsHalf: totals?.valueTicketsHalf || "0.00",
        discount: totals?.discount || "0.00",
        total: totals?.total || "0.00",
      },
      paymentDetails: { pix: null },
      sentEmails: [],
      errorLog: error.message,
    };

    await CheckoutRepository.saveCheckout(errorCheckoutData);
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

    const paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: payer.name,
        Identity: payer.document.replace(/\D/g, ""),
      },
      Amount: totals.totalInCents,
    };

    const boletoResponse = await BancoDoBrasilService.createBoletoPayment(
      paymentData.Amount,
      paymentData.Customer,
      payer,
      ticketQuantity,
      halfTickets,
      coupon,
      participants
    );

    const checkoutData = {
      transactionId: paymentData.MerchantOrderId,
      timestamp: new Date().toISOString(),
      status: "pending",
      paymentMethod: "boleto",
      totalAmount: totals.total,
      eventName: "Congresso Autismo MA 2025",
      participants,
      paymentId: boletoResponse.numeroBoleto,
      orderDetails: {
        ...totals,
        ticketQuantity,
        fullTickets: ticketQuantity - halfTickets,
        halfTickets,
        coupon: coupon || null,
      },
      paymentDetails: {
        boleto: {
          boletoUrl: boletoResponse.boletoUrl,
          qrCodePix: boletoResponse.qrCodePix,
          address: payer,
          pdfFilePath: boletoResponse.boletoFile,
          dataVencimento: boletoResponse.dataVencimento,
        },
      },
      sentEmails: [],
    };

    await CheckoutRepository.saveCheckout(checkoutData);

    if (!fs.existsSync(boletoResponse.boletoFile)) {
      throw new Error(
        `Arquivo PDF não encontrado: ${boletoResponse.boletoFile}`
      );
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=boleto_${boletoResponse.numeroBoleto}.pdf`
    );
    res.setHeader("x-payment-id", boletoResponse.numeroBoleto);
    const fileStream = fs.createReadStream(boletoResponse.boletoFile);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      fs.unlink(boletoResponse.boletoFile, (err) => {
        if (err) console.error("Erro ao remover o PDF:", err);
      });
    });

    fileStream.on("error", (err) => {
      throw err;
    });
  } catch (error) {
    console.error("Erro ao processar boleto:", error.message);

    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
    const errorCheckoutData = {
      transactionId: `ORDER_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: "error",
      paymentMethod: "boleto",
      totalAmount: totals?.total || "0.00",
      eventName: "Congresso Autismo MA 2025",
      participants: participants || [],
      paymentId: null,
      orderDetails: {
        ticketQuantity,
        fullTickets: ticketQuantity - halfTickets,
        halfTickets,
        coupon: coupon || null,
        valueTicketsAll: totals?.valueTicketsAll || "0.00",
        valueTicketsHalf: totals?.valueTicketsHalf || "0.00",
        discount: totals?.discount || "0.00",
        total: totals?.total || "0.00",
      },
      paymentDetails: { boleto: payer || null },
      sentEmails: [],
      errorLog: error.message,
    };

    await CheckoutRepository.saveCheckout(errorCheckoutData);
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

module.exports = {
  processCreditPayment,
  processPixPayment,
  processBoletoPayment,
  validateCoupon,
  calculateTotals,
  fetchCieloSales,
  verifyPayment,
  verifyAllPayments,
};
