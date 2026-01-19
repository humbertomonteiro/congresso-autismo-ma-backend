const { firebase } = require("./src/config");
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
} = require("firebase/firestore");

// Dados dos 22 nomes extraídos do arquivo XLSX
const transactions = [
  {
    name: "Amanda Silva",
    document: "61358194378",
    email: "amandarochapsicopedagoga@gmail.com",
    phone: "98984810013",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Master",
    timestamp: "2026-03-19T20:15:29",
    transactionId: "28937767224JPR7QGDRC",
  },
  {
    name: "PLACIANE SANTANA",
    document: "97930245349",
    email: "placiane.rocha18@gmail.com",
    phone: "98992319972",
    totalAmount: "399.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-03-18T20:05:00",
    transactionId: "28937767224JOT6QU6VC",
  },
  {
    name: "Kenia Coca",
    document: "133821102",
    email: "keniacoca@oitlook.com",
    phone: "67996649056",
    totalAmount: "399.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Master",
    timestamp: "2026-03-18T18:37:30",
    transactionId: "28937767224JOT6HBDDC",
  },
  {
    name: "Liciany Oliveira",
    document: "99328100372",
    email: "lindosolindoso1@gmai.com",
    phone: "98987416105",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Elo",
    timestamp: "2026-02-14T18:50:21",
    transactionId: "28937767224IQT056LTC",
  },
  {
    name: "Vanete Carvalho",
    document: "75388170349",
    email: "evanetebotao@hotmail.com",
    phone: "98982514100",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-14T10:28:52",
    transactionId: "28937767224IQSSUT92C",
  },
  {
    name: "EDIMARA LOPES",
    document: "4671506300",
    email: "edimaradasilvalopes@gmail.com",
    phone: "98985248917",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-13T19:56:32",
    transactionId: "28937767224IPV00PEFC",
  },
  {
    name: "Yara Correa",
    document: "91034086391",
    email: "yaraccoelho@gmail.com",
    phone: "98988864788",
    totalAmount: "499.00",
    paymentMethod: "pix",
    timestamp: "2026-02-13T17:08:50",
    transactionId: "2810a6d5-5f26-3911-9461-50f8ff9e2031",
  },
  {
    name: "Rafaella Cruz",
    document: "65897153353",
    email: "rafaella.sc@hotmail.com",
    phone: "98985176103",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Elo",
    timestamp: "2026-02-13T09:03:32",
    transactionId: "28937767224IPUTN7JBC",
  },
  {
    name: "Rosa Campos",
    document: "6216973380",
    email: "a3familiash@gmail.com",
    phone: "98982163674",
    totalAmount: "449.00",
    paymentMethod: "pix",
    timestamp: "2026-02-12T18:07:30",
    transactionId: "0a774492-26ea-3f17-9084-c8ab50c84e56",
  },
  {
    name: "Creuziana Araújo",
    document: "91429439149",
    email: "creuzianaxavier@gmail.com",
    phone: "98989149724",
    totalAmount: "499.00",
    paymentMethod: "pix",
    timestamp: "2026-02-12T07:44:37",
    transactionId: "e0631dd9-418c-377f-89da-1c73090f89c2",
  },
  {
    name: "Ádilla Pereira",
    document: "4814909306",
    email: "adilla_araujo@hotmail.com",
    phone: "99981500826",
    totalAmount: "499.00",
    paymentMethod: "pix",
    timestamp: "2026-02-12T00:20:37",
    transactionId: "1ce5b41c-8085-348f-a46a-93ce607b7d02",
  },
  {
    name: "Carolina Ramalho",
    document: "92026730420",
    email: "carolvramalho@gmail.com",
    phone: "98991616748",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T19:35:26",
    transactionId: "28937767224IO30L49UC",
  },
  {
    name: "José Moura",
    document: "97017604334",
    email: "cemethodus.altoalegre@hotmail.com",
    phone: "99984499323",
    totalAmount: "499.00",
    paymentMethod: "pix",
    timestamp: "2026-02-11T13:54:46",
    transactionId: "85b48045-dc9d-38f7-bb67-82c7fccdb171",
  },
  {
    name: "Maria Souza",
    document: "70472491334",
    email: "mj39as2015@gmail.com",
    phone: "98981243317",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Master",
    timestamp: "2026-02-11T12:54:04",
    transactionId: "28937767224IO2V5METC",
  },
  {
    name: "Livia Caldas",
    document: "46758259315",
    email: "caldasliviarachel@gmail.com",
    phone: "98988293741",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T12:48:39",
    transactionId: "28937767224IO2V5RREC",
  },
  {
    name: "Aline Branco",
    document: "1327188392",
    email: "psicorecruta71@gmail.com",
    phone: "98982727279",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Master",
    timestamp: "2026-02-11T11:49:56",
    transactionId: "28937767224IO2UU0PCC",
  },
  {
    name: "Christatielly Oliveira",
    document: "99744384387",
    email: "chris1334_rodrigues@hotmail.com",
    phone: "99982136297",
    totalAmount: "499.00",
    paymentMethod: "pix",
    timestamp: "2026-02-11T11:40:06",
    transactionId: "0ced8f0c-7eb6-3e91-b573-77aff6452b92",
  },
  {
    name: "Mayane Santos",
    document: "4723211373",
    email: "mayanecristinass@gmail.com",
    phone: "98982858361",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Master",
    timestamp: "2026-02-11T11:31:52",
    transactionId: "28937767224IO2URBFIC",
  },
  {
    name: "Milca Gart",
    document: "6165703330",
    email: "milcasg12@gmail.com",
    phone: "98970245736",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T11:28:21",
    transactionId: "28937767224IO2UQKR7C",
  },
  {
    name: "Patrícia Ataide",
    document: "72489103334",
    email: "patricia.ataide@ufma.br",
    phone: "98988421317",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T11:22:01",
    transactionId: "28937767224IO2UPR9IC",
  },
  {
    name: "Évylla Araújo",
    document: "756497302",
    email: "evylla_21@hotmail.com",
    phone: "98987511015",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T09:34:55",
    transactionId: "28937767224IO2U85LVC",
  },
  {
    name: "Stefanny Matos",
    document: "61344924344",
    email: "stefannybrendam@gmail.com",
    phone: "98985076036",
    totalAmount: "499.00",
    paymentMethod: "creditCard",
    creditCardBrand: "Visa",
    timestamp: "2026-02-11T09:05:55",
    transactionId: "28937767224IO2U3S6GC",
  },
];

// Função para adicionar transações ao Firestore
async function addTransactionsToFirestore() {
  for (const transaction of transactions) {
    const q = query(
      collection(firebase.db, "checkouts"),
      where("transactionId", "==", transaction.transactionId)
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      console.log(
        `Transação ${transaction.transactionId} já existe. Pulando...`
      );
      continue;
    }

    if (!querySnapshot.empty) {
      console.log(
        `Transação ${transaction.transactionId} já existe. Pulando...`
      );
      continue;
    }

    // Formata o documento conforme a estrutura do Firestore
    const docData = {
      document: `${transaction.document}`,
      eventName: "Congresso Autismo MA 2026",
      totalAmount: transaction.totalAmount,
      orderDetails: {
        coupon: null,
        discount: "0.00",
        fullTickets: transaction.totalAmount === "499.00" ? 1 : 0,
        halfTickets:
          transaction.totalAmount === "399.00" ||
          transaction.totalAmount === "449.00"
            ? 1
            : 0,
        ticketQuantity: 1,
        total: transaction.totalAmount,
        totalInCents: parseFloat(transaction.totalAmount) * 100,
        valueTicketsAll:
          transaction.totalAmount === "499.00"
            ? transaction.totalAmount
            : "0.00",
        valueTicketsHalf:
          transaction.totalAmount === "399.00" ||
          transaction.totalAmount === "449.00"
            ? transaction.totalAmount
            : "0.00",
      },
      participants: [
        {
          document: transaction.document,
          documentType: transaction.document.length === 11 ? "cpf" : "cnpj",
          email: transaction.email,
          isHalfPrice: true,
          name: transaction.name,
          number: `(${transaction.phone.slice(0, 2)}) ${transaction.phone.slice(
            2
          )}`,
        },
      ],
      paymentMethod: transaction.paymentMethod,
      paymentDetails:
        transaction.paymentMethod === "creditCard"
          ? {
              creditCard: {
                brand: transaction.creditCardBrand,
              },
            }
          : {},
      status: "approved",
      timestamp: new Date(transaction.timestamp).toISOString(),
      transactionId: transaction.transactionId,
      import: "cielo",
      importPendings: true,
    };

    // Adiciona o documento com ID automático
    const newDocRef = doc(collection(firebase.db, "checkouts"));
    await setDoc(newDocRef, docData);
    console.log(`Adicionado: ${transaction.name} - ID: ${newDocRef.id}`);
  }

  console.log("Importação concluída!");
}

// Executa a função
addTransactionsToFirestore().catch((error) => {
  console.error("Erro ao adicionar transações:", error);
});
// test-google-script.js
const axios = require("axios");

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbyRThOh4oJ8CRpEgrScKVKAVk-S2uB21M6DiEKeyFlpB3rc0uiemWSJe8iGzVi8K8cf/exec";

async function testGoogleScript() {
  console.log("🧪 Testando conexão com Google Apps Script...");

  const testData = {
    timestamp: new Date().toISOString(),
    nomeCliente: "TESTE CONEXÃO",
    cpfCliente: "111.222.333-44",
    diagnostico: "Teste de conexão",
    sexo: "MASCULINO",
    nomeMae: "Mãe Teste",
    cpfMae: "222.333.444-55",
    telefoneMae: "(11) 99999-9999",
    emergenciaContato: "Teste",
    autorizacao: "SIM",
    test: true,
  };

  try {
    const response = await axios.post(WEB_APP_URL, testData, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log("✅ Resposta do Web App:", response.data);
    console.log("📊 Status:", response.status);
  } catch (error) {
    console.error("❌ Erro:", error.message);
    if (error.response) {
      console.error("📋 Resposta de erro:", error.response.data);
      console.error("🔢 Status code:", error.response.status);
    }
  }
}

testGoogleScript();
