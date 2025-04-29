const CheckoutRepository = require("./src/repositories/CheckoutRepository");
const BancoDoBrasilService = require("./src/services/BancoDoBrasilService");

const verificarBoletos = async () => {
  try {
    // const checkouts = await CheckoutRepository.fetchCheckouts({
    //   paymentMethod: "boleto",
    // });

    // const arrayNumerosBoletos = checkouts.map(
    //   (checkout) => checkout.transactionId
    // );

    // const statusBoletos = await Promise.all(
    //   arrayNumerosBoletos.map((number) =>
    //     BancoDoBrasilService.getBoletoStatus(number)
    //   )
    // );

    const statusBoleto = await BancoDoBrasilService.getBoletoStatus(
      "00037412305581811744"
    );

    // console.log("Status dos boletos:", statusBoletos);
    console.log("Status dos boletos:", statusBoleto);
  } catch (error) {
    console.error("Erro ao verificar boletos:", error);
    throw error;
  }
};

verificarBoletos();
