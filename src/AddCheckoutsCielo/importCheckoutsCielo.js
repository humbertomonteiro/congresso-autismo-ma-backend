const { doc, setDoc } = require("firebase/firestore");
const XLSX = require("xlsx");
const dotenv = require("dotenv");
const { firebase } = require("../config");
const path = require("path");
const fs = require("fs");

// Carrega variáveis de ambiente
dotenv.config();

// Pega o db do objeto firebase
const db = firebase.db;

// Função para converter data DD/MM/YYYY HH:MM:SS para ISO
const parseDateToISO = (dateStr) => {
  if (!dateStr) return null;
  const [date, time] = dateStr.split(" ");
  const [day, month, year] = date.split("/");
  return new Date(
    `${year}-${month}-${day}T${time || "00:00:00"}`
  ).toISOString();
};

// Função para determinar tipo de ingresso com base no valor
const determineTicketType = (totalAmount) => {
  const value = parseFloat(totalAmount);
  if (value === 399) {
    return {
      halfTickets: 1,
      fullTickets: 0,
      valueTicketsHalf: "399.00",
      valueTicketsAll: "0.00",
    };
  } else if (value === 499) {
    return {
      halfTickets: 0,
      fullTickets: 1,
      valueTicketsHalf: "0.00",
      valueTicketsAll: "499.00",
    };
  } else {
    // Caso o valor não seja 399 nem 499, assume inteira por padrão
    return {
      halfTickets: 0,
      fullTickets: 1,
      valueTicketsHalf: "0.00",
      valueTicketsAll: totalAmount.toString(),
    };
  }
};

// Função para importar checkouts em lotes de 17 a cada 25 minutos
const importCheckoutsFromExcelInBatches = (filePath) => {
  const absolutePath = path.resolve(__dirname, filePath);
  console.log("Caminho absoluto resolvido:", absolutePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Erro: O arquivo não foi encontrado em ${absolutePath}`);
    return;
  }

  const workbook = XLSX.readFile(absolutePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  const validCheckouts = data.filter(
    (row) =>
      row["Número do Pedido"] &&
      !row["Número do Pedido"].includes("TOTAL") &&
      !row["Número do Pedido"].includes("ACOMPANHAMENTO")
  );
  console.log(
    `Total de checkouts válidos encontrados: ${validCheckouts.length}`
  );

  let index = 0;
  const batchSize = 17;
  const intervalMs = 25 * 60 * 1000; // 25 minutos em milissegundos

  const processBatch = async () => {
    const batch = validCheckouts.slice(index, index + batchSize);
    if (batch.length === 0) {
      console.log("Todos os checkouts foram importados!");
      clearInterval(intervalId);
      return;
    }

    for (const checkout of batch) {
      const isCreditCard =
        checkout["Meio de Pagamento"] === "Cartão de crédito";
      const ticketType = determineTicketType(checkout["Valor Total"]);
      const checkoutData = {
        transactionId: checkout["Número do Pedido"],
        timestamp: parseDateToISO(checkout["Data do Pedido"]),
        status:
          checkout["Status do Pagamento"] === "Pago" ? "approved" : "error", // Ajustado aqui
        paymentMethod: isCreditCard ? "creditCard" : "pix",
        totalAmount: checkout["Valor Total"].toString(),
        eventName: "Congresso Autismo MA 2026",
        participants: [
          {
            name: checkout["Nome Comprador"],
            document: checkout["CPF/CNPJ"],
            email: checkout["Email"],
            number: checkout["Telefone"],
          },
        ],
        paymentId: checkout["TID"],
        orderDetails: {
          valueTicketsAll: ticketType.valueTicketsAll,
          valueTicketsHalf: ticketType.valueTicketsHalf,
          discount: "0.00",
          total: checkout["Valor Total"].toString(),
          totalInCents: parseInt(checkout["Valor Total"]) * 100,
          ticketQuantity: parseInt(checkout["Itens no Carrinho"]),
          fullTickets: ticketType.fullTickets,
          halfTickets: ticketType.halfTickets,
          coupon: null,
        },
        paymentDetails: isCreditCard
          ? {
              creditCard: {
                brand: checkout["Bandeira"],
                installments: 1,
                authorizationCode: checkout["Cod Autorização"] || null,
                nsu: checkout["NSU"] || null,
              },
            }
          : {
              pix: {
                qrCodeString: null,
                qrCodeLink: null,
                expirationDate: null,
              },
            },
        document: checkout["CPF/CNPJ"],
        sentEmails: [],
        paidAt:
          checkout["Status do Pagamento"] === "Pago"
            ? parseDateToISO(checkout["Data Pagamento"] + " 00:00:00")
            : null,
        import: "cielo",
      };

      try {
        await setDoc(
          doc(db, "checkouts", checkout["Número do Pedido"]),
          checkoutData
        );
        console.log(
          `Checkout ${checkout["Número do Pedido"]} importado com sucesso!`
        );
      } catch (error) {
        console.error(
          `Erro ao importar ${checkout["Número do Pedido"]}:`,
          error
        );
      }
    }

    index += batchSize;
    console.log(`Lote processado. Restantes: ${validCheckouts.length - index}`);
  };

  // Processa o primeiro lote imediatamente
  processBatch();
  // Agenda os próximos lotes a cada 25 minutos
  const intervalId = setInterval(processBatch, intervalMs);
};

// Executar o script
importCheckoutsFromExcelInBatches("checkouts-cielo.xlsx");
