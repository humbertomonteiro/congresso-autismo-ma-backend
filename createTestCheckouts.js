const { db } = require("./src/config").firebase;
const { collection, addDoc } = require("firebase/firestore");

async function createTestCheckouts() {
  const testCheckouts = [
    {
      transactionId: "TEST_001",
      status: "test",
      paymentMethod: "test",
      totalAmount: "100.00",
      eventName: "Congresso Autismo MA 2025",
      participants: [
        {
          name: "Ana Teste",
          email: "seu.email@gmail.com", // Use seu email pra receber
        },
      ],
      paymentId: "TEST_PAYMENT_001",
      orderDetails: {
        ticketQuantity: 1,
        fullTickets: 1,
        halfTickets: 0,
        fullTicketsValue: "100.00",
        halfTicketsValue: "0.00",
        discount: "0.00",
        coupon: null,
      },
      paymentDetails: {
        test: true,
      },
      sentEmails: [],
      pendingEmails: [],
      qrCodesSent: false,
      createdAt: new Date().toISOString(),
    },
    {
      transactionId: "TEST_002",
      status: "test",
      paymentMethod: "test",
      totalAmount: "200.00",
      eventName: "Congresso Autismo MA 2025",
      participants: [
        {
          name: "Bruno Teste",
          email: "seu.email@gmail.com",
        },
      ],
      paymentId: "TEST_PAYMENT_002",
      orderDetails: {
        ticketQuantity: 2,
        fullTickets: 2,
        halfTickets: 0,
        fullTicketsValue: "200.00",
        halfTicketsValue: "0.00",
        discount: "0.00",
        coupon: null,
      },
      paymentDetails: {
        test: true,
      },
      sentEmails: [],
      pendingEmails: [],
      qrCodesSent: false,
      createdAt: new Date().toISOString(),
    },
  ];

  try {
    for (const checkout of testCheckouts) {
      const docRef = await addDoc(collection(db, "checkouts"), checkout);
      console.log(`Checkout de teste criado com ID: ${docRef.id}`);
    }
    console.log("Checkouts de teste criados com sucesso!");
  } catch (error) {
    console.error("Erro ao criar checkouts de teste:", error.message);
  }
}

createTestCheckouts();
