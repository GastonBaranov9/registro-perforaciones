import { getReportePozo } from "../services/generar-informe-consultas.ts";
import { generarPDF } from "../pdf/pdf-generate.ts";

const pozoId = Number(process.argv[2] || 1);

async function main() {
  const data = await getReportePozo(pozoId);
  if (!data) {
    console.error("No se encontró información para el pozo indicado.");
    return;
  }
  console.log("Datos obtenidos:", data);

  await generarPDF(data, pozoId);
  console.log(`Informe generado en ./output/informe_pozo_${pozoId}.pdf`);
}

main();
