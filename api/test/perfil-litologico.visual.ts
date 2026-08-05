import * as fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { crearPerfilLitologico, dibujarPerfilLitologico, type PerfilLitologico } from "../src/pdf/perfil-litologico.ts";

const destino = process.argv[2];
if (!destino) throw new Error("Uso: node perfil-litologico.visual.ts <directorio-salida>");
await fs.mkdir(destino, { recursive: true });

const minimo = crearPerfilLitologico(
  [{ desde_m: 0, hasta_m: 0.6, material: "Arena fina" }, { desde_m: 1.2, hasta_m: 5, material: "Basalto gris" }],
  8,
  [{ profundidad_m: 3.4 }],
)!;
const finas = crearPerfilLitologico(
  Array.from({ length: 54 }, (_, i) => ({ desde_m: i * 0.5, hasta_m: (i + 1) * 0.5, material: `Material desconocido ${i % 7}` })),
  240,
  [{ profundidad_m: 4 }, { profundidad_m: 16.5 }, { profundidad_m: 180 }],
)!;

await fs.writeFile(path.join(destino, "perfil-web-minimo.html"), html(minimo));
await fs.writeFile(path.join(destino, "perfil-web-capas-finas.html"), html(finas));
await guardarPdf(path.join(destino, "perfil-pdf-minimo.pdf"), minimo);
await guardarPdf(path.join(destino, "perfil-pdf-multipagina.pdf"), finas);
console.log(JSON.stringify({ destino, paginasMinimo: minimo.rangos.length, paginasFinas: finas.rangos.length }));

async function guardarPdf(archivo: string, perfil: PerfilLitologico) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  dibujarPerfilLitologico(doc, perfil, font, bold);
  await fs.writeFile(archivo, await doc.save());
}

function html(perfil: PerfilLitologico) {
  const secciones = perfil.rangos.map((rango) => svg(perfil, rango)).join("");
  return `<!doctype html><meta charset="utf-8"><title>${perfil.titulo}</title><style>body{font:14px Arial;color:#111;max-width:900px;margin:auto}svg{width:100%;min-width:620px}.guia{stroke:#777;stroke-dasharray:4 5}.aporte{fill:#1473e6;stroke:#052f6d}.azul{fill:#073b80;font-weight:bold}text{font-size:11px}path{stroke:#222;fill:none}circle.punto{fill:#222}</style><h1>${perfil.titulo}</h1>${secciones}`;
}

function svg(perfil: PerfilLitologico, rango: PerfilLitologico["rangos"][number]) {
  const y = (m: number) => 70 + ((m - rango.desde_m) / (rango.hasta_m - rango.desde_m)) * 700;
  const ticks = [rango.desde_m];
  for (let m = Math.ceil(rango.desde_m / perfil.paso_escala_m) * perfil.paso_escala_m; m < rango.hasta_m; m += perfil.paso_escala_m) if (m > rango.desde_m) ticks.push(m);
  ticks.push(rango.hasta_m);
  const tramos = perfil.tramos.filter((t) => t.desde_m < rango.hasta_m && t.hasta_m > rango.desde_m);
  const capas = tramos.map((t) => { const desde = Math.max(t.desde_m, rango.desde_m); const hasta = Math.min(t.hasta_m, rango.hasta_m); return `<rect x="90" y="${y(desde)}" width="180" height="${y(hasta) - y(desde)}" fill="${t.estilo.color}" stroke="#111"/><rect x="90" y="${y(desde)}" width="180" height="${y(hasta) - y(desde)}" fill="url(#${t.estilo.patron})" stroke="#111"/><line x1="270" y1="${y((desde + hasta) / 2)}" x2="${300 + t.carril_etiqueta * 105}" y2="${y((desde + hasta) / 2)}"/><text x="${306 + t.carril_etiqueta * 105}" y="${y((desde + hasta) / 2) + 4}">${esc(`${t.desde_m}-${t.hasta_m} m · ${t.material}`)}</text>`; }).join("");
  const guias = ticks.map((m) => `<line x1="80" y1="${y(m)}" x2="730" y2="${y(m)}" class="guia"/><text x="12" y="${y(m) + 4}">${m} m</text>`).join("");
  const aportes = perfil.aportes.filter((a) => a.profundidad_m >= rango.desde_m && a.profundidad_m <= rango.hasta_m).map((a) => { const x1 = 90 + 180 * a.geometria.x_inicio; const x2 = 90 + 180 * a.geometria.x_fin; return `<rect x="${x1}" y="${y(a.profundidad_m) - 4}" width="${x2 - x1}" height="8" fill="#9bd5f5" stroke="#064f91"/><rect x="${x1}" y="${y(a.profundidad_m) - 4}" width="${x2 - x1}" height="8" fill="url(#agua)"/><circle cx="282" cy="${y(a.profundidad_m)}" r="5" class="aporte"/><text x="294" y="${y(a.profundidad_m) - 6}" class="azul">Aporte de agua ${a.profundidad_m} m</text>`; }).join("");
  const extX = 90 + 180 * perfil.seccion_pozo.tuberia_exterior_inicio; const extW = 180 * (perfil.seccion_pozo.tuberia_exterior_fin - perfil.seccion_pozo.tuberia_exterior_inicio);
  const intX = 90 + 180 * perfil.seccion_pozo.tuberia_interior_inicio; const intW = 180 * (perfil.seccion_pozo.tuberia_interior_fin - perfil.seccion_pozo.tuberia_interior_inicio);
  return `<h2>${rango.desde_m}-${rango.hasta_m} m</h2><svg viewBox="0 0 760 820"><defs><pattern id="diagonal" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0"/></pattern><pattern id="diagonal-inversa" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8"/></pattern><pattern id="cruz" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8M4 0V8"/></pattern><pattern id="puntos" width="8" height="8" patternUnits="userSpaceOnUse"><circle class="punto" cx="4" cy="4" r="1.2"/></pattern><pattern id="horizontal" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8"/></pattern><pattern id="vertical" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M4 0V8"/></pattern><pattern id="agua" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 4Q3 1 6 4T12 4" stroke="#064f91"/></pattern></defs>${guias}<rect x="90" y="70" width="180" height="700" fill="#fafafa" stroke="#111"/>${capas}${aportes}<rect x="${extX}" y="70" width="${extW}" height="700" fill="none" stroke="#222" stroke-width="2"/><rect x="${intX}" y="70" width="${intW}" height="700" fill="none" stroke="#555" stroke-dasharray="3 2"/></svg>`;
}

function esc(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
