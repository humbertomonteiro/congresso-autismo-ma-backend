/**
 * Busca todos os participantes cujo checkout contém determinado termo
 * no campo `observation` (case-insensitive, correspondência parcial)
 * e gera um arquivo Excel com os resultados.
 *
 * Uso:
 *   node src/utils/functions/find_participants_by_observation.js vivian
 *   node src/utils/functions/find_participants_by_observation.js "algum texto"
 */

const ExcelJS = require("exceljs");
const path = require("path");
const CheckoutRepository = require("../../repositories/CheckoutRepository");

const searchTerm = (process.argv[2] || "vivian").toLowerCase().trim();

const run = async () => {
  console.log(
    `\nBuscando participantes com "${searchTerm}" na observação...\n`
  );

  const checkouts = await CheckoutRepository.fetchCheckouts();

  const matching = checkouts.filter((c) =>
    (c.observation || "").toLowerCase().includes(searchTerm)
  );

  if (matching.length === 0) {
    console.log("Nenhum checkout encontrado com esse termo.");
    return;
  }

  console.log(
    `${matching.length} checkout(s) encontrado(s). Gerando Excel...\n`
  );

  const rows = [];

  for (const checkout of matching) {
    const participants = await CheckoutRepository.getParticipantsByCheckout(
      checkout.id
    );
    for (const p of participants) {
      rows.push({
        nome: p.name || "",
        email: p.email || "",
        celular: p._legacy.number || p.phone || "",
        cpf: p.document || p.cpf || "",
        observacao: checkout.observation || "",
      });
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Participantes");

  sheet.columns = [
    { header: "Nome", key: "nome", width: 35 },
    { header: "E-mail", key: "email", width: 35 },
    { header: "Celular", key: "celular", width: 20 },
    { header: "CPF", key: "cpf", width: 20 },
    { header: "Observação", key: "observacao", width: 40 },
  ];

  // Cabeçalho em negrito
  sheet.getRow(1).font = { bold: true };

  sheet.addRows(rows);

  const fileName = `participantes_${searchTerm.replace(
    /\s+/g,
    "_"
  )}_${Date.now()}.xlsx`;
  const outputPath = path.resolve(__dirname, fileName);
  await workbook.xlsx.writeFile(outputPath);

  console.log(`Total: ${rows.length} participante(s) exportado(s).`);
  console.log(`Arquivo salvo em: ${outputPath}`);
};

run().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
