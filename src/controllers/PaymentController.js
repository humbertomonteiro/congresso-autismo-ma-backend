// src/controllers/PaymentController.js
const CheckoutService = require("../services/CheckoutService");
const CieloService = require("../services/CieloService");
const BancoDoBrasilService = require("../services/BancoDoBrasilService");
const CheckoutRepository = require("../repositories/CheckoutRepository");
const fs = require("fs");

const EVENT_NAME = "Congresso Autismo MA 2025";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mapCieloStatusToCustom = (cieloStatus) => {
  switch (cieloStatus) {
    case 1:
    case 2:
      return "approved";
    case 0:
    case 10:
      return "pending";
    case 3:
    case 9:
    case 11:
      return "error";
    default:
      return "pending";
  }
};

const processCreditPayment = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon, participants, creditCardData } =
    req.body;
  let creditResponse;
  let paymentData;
  let totals;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateCreditCard(creditCardData);
    totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: { Name: participants[0].name },
      Payment: {
        Type: "CreditCard",
        Amount: totals.totalInCents,
        Installments: parseInt(creditCardData.installments),
        SoftDescriptor: EVENT_NAME,
        CreditCard: {
          CardNumber: creditCardData.cardNumber.replace(/\s/g, ""),
          Holder: creditCardData.cardName,
          ExpirationDate: creditCardData.maturity,
          SecurityCode: creditCardData.cardCode,
          Brand: creditCardData.brand,
        },
      },
    };

    creditResponse = await CieloService.createCreditPayment(paymentData);

    let statusResponse;
    const maxAttempts = 5;
    let attempts = 0;
    const finalStatuses = [1, 2, 3, 9, 11];

    do {
      statusResponse = await CieloService.getPaymentStatus(
        creditResponse.paymentId,
        paymentData.MerchantOrderId
      );
      if (finalStatuses.includes(statusResponse.Status)) break;
      attempts++;
      if (attempts < maxAttempts) await delay(5000);
    } while (attempts < maxAttempts);

    const customStatus = mapCieloStatusToCustom(statusResponse.Status);
    if (customStatus === "error") {
      throw new Error(
        `Transação não aprovada: ${statusResponse.ReturnMessage}`
      );
    }

    const checkoutData = {
      transactionId: paymentData.MerchantOrderId,
      timestamp: new Date().toISOString(),
      status: customStatus,
      paymentMethod: "creditCard",
      totalAmount: totals.total,
      eventName: EVENT_NAME,
      participants,
      paymentId: creditResponse.paymentId,
      orderDetails: {
        ...totals,
        ticketQuantity,
        fullTickets: ticketQuantity - halfTickets,
        halfTickets,
        coupon: coupon || null,
      },
      paymentDetails: {
        creditCard: {
          last4Digits: creditCardData.cardNumber.slice(-4),
          installments: creditCardData.installments,
          brand: creditCardData.brand || "Visa",
        },
      },
      sentEmails: [],
    };

    await CheckoutRepository.saveCheckout(checkoutData);

    // Enviar email de confirmação se o status for "approved"
    if (customStatus === "approved") {
      const participantEmails = participants.map((p) => p.email);
      try {
        const templatePath = path.join(
          __dirname,
          "../templates/emailTemplate.html"
        );
        let htmlTemplate = await fs.readFile(templatePath, "utf-8");

        // Substituir placeholders no template
        htmlTemplate = htmlTemplate
          .replace(/{{PAYMENT_ID}}/g, creditResponse.paymentId)
          .replace(/{{TOTAL_AMOUNT}}/g, totals.total)
          .replace(
            /{{PARTICIPANTS}}/g,
            participants.map((p) => p.name).join(", ")
          )
          .replace(/{{STATUS}}/g, "Aprovado");

        await EmailService.sendEmail({
          from: process.env.EMAIL_USER_1, // Usa a primeira conta configurada
          to: participantEmails,
          subject: "Confirmação de Pagamento - Congresso Autismo MA 2025",
          html: htmlTemplate,
          attachments: [], // Sem anexos por enquanto, mas pode adicionar QR codes depois
        });

        checkoutData.sentEmails = participantEmails; // Registra os emails enviados
        await CheckoutRepository.saveCheckout(checkoutData); // Atualiza o Firestore
      } catch (emailError) {
        console.error(
          "Falha ao enviar email de confirmação, mas pagamento foi processado:",
          emailError.message
        );
        // Não interrompe o fluxo do pagamento
      }
    }

    const message =
      customStatus === "pending"
        ? "Pagamento em processamento, aguarde a confirmação."
        : "Pagamento processado com sucesso";
    res.sendResponse(200, true, message, {
      paymentId: creditResponse.paymentId,
      status: customStatus,
      totalAmount: totals.total,
    });
  } catch (error) {
    console.error("Erro ao processar crédito:", error.message);

    if (creditResponse?.paymentId) {
      const status = await CieloService.getPaymentStatus(
        creditResponse.paymentId,
        paymentData?.MerchantOrderId || `ORDER_${Date.now()}`
      );
      if ([1, 2].includes(status.Status)) {
        await CieloService.voidPayment(creditResponse.paymentId);
      }
    }

    const errorCheckoutData = {
      transactionId: paymentData?.MerchantOrderId || `ORDER_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: "error",
      paymentMethod: "creditCard",
      totalAmount: totals?.total || "0.00",
      eventName: EVENT_NAME,
      participants: participants || [],
      paymentId: creditResponse?.paymentId || null,
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
            totalInCents: 0,
            total: "0.00",
          },
      paymentDetails: {
        creditCard: {
          last4Digits: creditCardData?.cardNumber?.slice(-4) || "N/A",
          installments: creditCardData?.installments || 1,
          brand: creditCardData?.brand || "Visa",
        },
      },
      sentEmails: [],
      errorLog: error.message,
    };

    await CheckoutRepository.saveCheckout(errorCheckoutData);
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
        Identity: participants[0].cpf.replace(/\D/g, ""),
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
      eventName: EVENT_NAME,
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
      eventName: EVENT_NAME,
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
  const { ticketQuantity, halfTickets, coupon, participants, boletoData } =
    req.body;

  try {
    CheckoutService.validateParticipants(participants, ticketQuantity);
    CheckoutService.validateBoleto(boletoData);
    const totals = CheckoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    const paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: participants[0].name,
        Identity: participants[0].cpf.replace(/\D/g, ""),
      },
      Amount: totals.totalInCents,
    };

    const boletoResponse = await BancoDoBrasilService.createBoletoPayment(
      paymentData.Amount,
      paymentData.Customer,
      boletoData,
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
      eventName: EVENT_NAME,
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
          address: boletoData,
          pdfFilePath: boletoResponse.boletoFile,
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
      eventName: EVENT_NAME,
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
      paymentDetails: { boleto: boletoData || null },
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

module.exports = {
  processCreditPayment,
  processPixPayment,
  processBoletoPayment,
  validateCoupon,
  calculateTotals,
  fetchCieloSales,
};
