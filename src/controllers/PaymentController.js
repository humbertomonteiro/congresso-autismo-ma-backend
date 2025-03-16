const checkoutService = require("../services/checkoutService");
const checkoutRepository = require("../repositories/checkoutRepository");
const cieloRepository = require("../repositories/cieloRepository");
const bancoDoBrasilService = require("../services/bancoDoBrasilService");
const { sendResponse } = require("../utils/response");
require("dotenv").config();
const fs = require("fs");

const EVENT_NAME = "Congresso Autismo MA 2025";

// Função auxiliar para aguardar alguns segundos
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Função para mapear status da Cielo para os seus status
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
  let paymentData = null;
  let totals = null;

  try {
    console.log("Iniciando processCreditPayment com dados:", {
      ticketQuantity,
      halfTickets,
      coupon,
      participants,
      creditCardData,
    });

    if (!/^\d{2}\/\d{4}$/.test(creditCardData.maturity)) {
      throw new Error("Data de validade deve estar no formato MM/AAAA");
    }

    checkoutService.validateParticipants(participants, ticketQuantity);
    checkoutService.validateCreditCard(creditCardData);
    totals = checkoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
    console.log("Totais calculados:", totals);

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

    console.log("Enviando pagamento para Cielo:", paymentData);
    creditResponse = await cieloRepository.createCreditPayment(paymentData);
    console.log("Resposta inicial da Cielo:", creditResponse);

    let statusResponse;
    const maxAttempts = 5;
    let attempts = 0;
    const finalStatuses = [1, 2, 3, 9, 11];

    do {
      console.log(
        `Consulta ${attempts + 1} ao status do pagamento: ${
          creditResponse.paymentId
        }`
      );
      statusResponse = await cieloRepository.getPaymentStatus(
        creditResponse.paymentId
      );
      console.log("Status retornado:", statusResponse);

      if (finalStatuses.includes(statusResponse.Status)) {
        break;
      }

      attempts++;
      if (attempts < maxAttempts) {
        await delay(5000);
      }
    } while (attempts < maxAttempts);

    const customStatus = mapCieloStatusToCustom(statusResponse.Status);
    console.log(`Status mapeado: ${customStatus}`);

    if (customStatus === "error") {
      throw new Error(
        `Transação não aprovada. Status: ${statusResponse.ReturnMessage}`
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

    console.log("Salvando checkout no Firebase:", checkoutData);
    await checkoutRepository.saveCheckout(checkoutData);

    let message = "Pagamento processado com sucesso";
    if (customStatus === "pending") {
      message = "Pagamento em processamento, aguarde a confirmação.";
    }
    sendResponse(res, 200, true, message, {
      paymentId: creditResponse.paymentId,
      status: customStatus,
      totalAmount: totals.total,
    });
  } catch (error) {
    console.error("Erro ao processar crédito:", error.message, error.stack);

    if (creditResponse && creditResponse.paymentId) {
      const status = await cieloRepository.getPaymentStatus(
        creditResponse.paymentId
      );
      if ([1, 2].includes(status.Status)) {
        await cieloRepository.voidPayment(creditResponse.paymentId);
        console.log("Transação estornada com sucesso.");
      }
    }

    let userMessage = "Erro ao processar pagamento com cartão";
    if (
      error.message.includes("rejeitado") ||
      error.message.includes("Status") ||
      error.message.includes("Blocked")
    ) {
      userMessage = error.message;
    }

    const errorCheckoutData = {
      transactionId: paymentData
        ? paymentData.MerchantOrderId
        : `ORDER_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: "error",
      paymentMethod: "creditCard",
      totalAmount: totals ? totals.total : "0.00",
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

    try {
      await checkoutRepository.saveCheckout(errorCheckoutData);
      console.log("Erro salvo no Firebase com status 'error'");
    } catch (saveError) {
      console.error("Erro ao salvar erro no Firebase:", saveError.message);
    }

    sendResponse(res, 500, false, userMessage, null, error.message);
  }
};

const processPixPayment = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon, participants } = req.body;

  let totals;
  let paymentData;

  try {
    checkoutService.validateParticipants(participants, ticketQuantity);
    totals = checkoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: participants[0].name,
        Identity: participants[0].cpf.replace(/\D/g, ""),
      },
      Amount: totals.totalInCents,
    };

    console.log("Enviando requisição de Pix ao Banco do Brasil:", paymentData);
    const pixResponse = await bancoDoBrasilService.createPixPayment(
      paymentData.Amount,
      paymentData.Customer
    );
    console.log("Resposta do Banco do Brasil para Pix:", pixResponse);

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

    console.log("Salvando checkout no Firebase:", checkoutData);
    await checkoutRepository.saveCheckout(checkoutData);

    sendResponse(
      res,
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
    console.error("Erro ao processar Pix:", error.message, error.stack);

    const errorCheckoutData = {
      transactionId: paymentData?.MerchantOrderId || `ORDER_${Date.now()}`,
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
      paymentDetails: {
        pix: null,
      },
      metadata: { errorLog: error.message },
      sentEmails: [],
    };

    try {
      console.log("Salvando checkout de erro no Firebase:", errorCheckoutData);
      await checkoutRepository.saveCheckout(errorCheckoutData);
    } catch (saveError) {
      console.error("Erro ao salvar o erro no Firebase:", saveError.message);
    }

    sendResponse(
      res,
      500,
      false,
      error.message || "Erro ao gerar Pix",
      null,
      error.message
    );
  }
};

const processBoletoPayment = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon, participants, boletoData } =
    req.body;

  let totals;
  let paymentData;

  try {
    checkoutService.validateParticipants(participants, ticketQuantity);
    checkoutService.validateBoleto(boletoData);
    totals = checkoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );

    paymentData = {
      MerchantOrderId: `ORDER_${Date.now()}`,
      Customer: {
        Name: participants[0].name,
        Identity: participants[0].cpf.replace(/\D/g, ""),
      },
      Amount: totals.totalInCents,
    };

    console.log(
      "Enviando requisição de Boleto ao Banco do Brasil:",
      paymentData
    );
    const boletoResponse = await bancoDoBrasilService.createBoletoPayment(
      paymentData.Amount,
      paymentData.Customer,
      boletoData,
      ticketQuantity,
      halfTickets,
      coupon || null,
      participants
    );
    console.log("Resposta do Banco do Brasil para Boleto:", boletoResponse);

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

    console.log("Salvando checkout no Firebase:", checkoutData);
    await checkoutRepository.saveCheckout(checkoutData);

    // Verificar se o arquivo PDF existe antes de enviar
    if (!fs.existsSync(boletoResponse.boletoFile)) {
      throw new Error(
        `Arquivo PDF não encontrado: ${boletoResponse.boletoFile}`
      );
    }

    console.log("Enviando PDF para o cliente:", boletoResponse.boletoFile);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=boleto_${boletoResponse.numeroBoleto}.pdf`
    );
    const fileStream = fs.createReadStream(boletoResponse.boletoFile);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      console.log("PDF enviado com sucesso");
      fs.unlink(boletoResponse.boletoFile, (err) => {
        if (err) console.error("Erro ao remover o PDF:", err);
        else
          console.log("PDF removido com sucesso:", boletoResponse.boletoFile);
      });
    });

    fileStream.on("error", (err) => {
      console.error("Erro ao enviar o PDF:", err);
      throw err; // Propaga o erro para o catch
    });
  } catch (error) {
    console.error("Erro ao processar boleto:", error.message, error.stack);

    if (error.response?.status === 503) {
      sendResponse(
        res,
        503,
        false,
        "Serviço temporariamente indisponível. Tente novamente mais tarde.",
        null,
        error.message
      );
    } else {
      const errorCheckoutData = {
        transactionId: paymentData?.MerchantOrderId || `ORDER_${Date.now()}`,
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
        paymentDetails: {
          boleto: boletoData || null,
        },
        metadata: { errorLog: error.message },
        sentEmails: [],
      };

      try {
        console.log(
          "Salvando checkout de erro no Firebase:",
          errorCheckoutData
        );
        await checkoutRepository.saveCheckout(errorCheckoutData);
      } catch (saveError) {
        console.error("Erro ao salvar o erro no Firebase:", saveError.message);
      }

      sendResponse(
        res,
        500,
        false,
        error.message || "Erro ao gerar boleto",
        null,
        error.message
      );
    }
  }
};

const validateCoupon = async (req, res) => {
  const { coupon, ticketQuantity } = req.body;

  try {
    checkoutService.calculateTotal(ticketQuantity, 0, coupon);
    sendResponse(res, 200, true, "Cupom válido", { valid: true });
  } catch (error) {
    console.error("Erro ao validar cupom:", error.message);
    sendResponse(res, 400, false, error.message, { valid: false });
  }
};

const calculateTotals = async (req, res) => {
  const { ticketQuantity, halfTickets, coupon } = req.body;

  try {
    const totals = checkoutService.calculateTotal(
      ticketQuantity,
      halfTickets,
      coupon
    );
    sendResponse(res, 200, true, "Totais calculados com sucesso", totals);
  } catch (error) {
    console.error("Erro ao calcular totais:", error.message);
    sendResponse(
      res,
      400,
      false,
      error.message || "Erro ao calcular totais",
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
};
