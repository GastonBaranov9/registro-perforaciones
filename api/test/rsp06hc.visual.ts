import * as fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { crearPerfilLitologico, dibujarPerfilLitologico } from '../src/pdf/perfil-litologico.ts';
import { ESPECIFICACION_PATRON, PATRONES_LITOLOGICOS } from '../src/pdf/litologia-patrones.ts';

const destino = process.argv[2];
if (!destino) throw new Error('Uso: node rsp06hc.visual.ts <directorio-salida>');
await fs.mkdir(destino, { recursive: true });
const colores = ['#202124','#555B61','#D7B77A','#B58B50','#9E463D','#B89062','#D29A91','#756657','#C58D8A'];
const patrones = ['basalt','basalt_fractured','sandstone_fine','sandstone_coarse','clay','sandy_clay','tosca','gravel_coarse','granite'] as const;
const nombres = ['Basalto negro','Basalto fracturado','Arenisca fina','Arenisca gruesa','Arcilla roja','Arena arcillosa','Tosca rosada','Gravilla gruesa','Granito rosado'];
const intervalos = patrones.map((patron, indice) => ({ desde_m: indice, hasta_m: indice + 1, material: nombres[indice], id_litologia: indice + 1, litologia_nombre: nombres[indice], litologia_color: colores[indice], litologia_patron: patron, litologia_activa: true }));
const perfil = crearPerfilLitologico(intervalos, 9, [{ profundidad_m: 5.5 }], [{ desde_m: 0, hasta_m: 9, diametro_pulg: 6, material_tuberia: 'PVC' }], [{ desde_m: 4, hasta_m: 7, diametro_pulg: 4, material_tuberia: 'Acero' }])!;
await fs.writeFile(path.join(destino, 'perfil-canónico.json'), JSON.stringify(perfil, null, 2));
await fs.writeFile(path.join(destino, 'perfil-web-rsp06hc.html'), html(perfil));
const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
dibujarPerfilLitologico(doc, perfil, font, bold); await fs.writeFile(path.join(destino, 'perfil-pdf-rsp06hc.pdf'), await doc.save());
console.log(JSON.stringify({ destino, litologias: nombres.length, agua: perfil.aportes.length, tuberias: perfil.tuberias.length, filtros: perfil.filtros.length, paginas: perfil.rangos.length }));

function html(modelo: typeof perfil) {
  const defs = PATRONES_LITOLOGICOS.map((clave) => { const s = ESPECIFICACION_PATRON[clave]; return `<pattern id="pat-${clave}" width="${s.paso}" height="${s.paso}" patternUnits="userSpaceOnUse"><path d="M1 4L5 2L9 5M1 9L9 1" stroke="#222" stroke-width=".8" fill="none"/><circle cx="${s.paso/2}" cy="${s.paso/2}" r="${s.tamano}" fill="#222"/></pattern>`; }).join('');
  const y = (m: number) => 70 + m * 75;
  const capas = modelo.tramos.map((t) => `<rect x="90" y="${y(t.desde_m)}" width="180" height="${y(t.hasta_m)-y(t.desde_m)}" fill="${t.estilo.color}"/><rect x="90" y="${y(t.desde_m)}" width="180" height="${y(t.hasta_m)-y(t.desde_m)}" fill="url(#pat-${t.estilo.patron})"/><text x="292" y="${y((t.desde_m+t.hasta_m)/2)}">${t.material}</text>`).join('');
  const agua = modelo.aportes.map((a) => `<rect x="95" y="${y(a.profundidad_m)-5}" width="170" height="10" fill="#67B9E8" stroke="#064F91"/><text x="292" y="${y(a.profundidad_m)}">Aporte de agua</text>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>RSP-06H-C evidencia</title><style>body{font:14px sans-serif}svg{max-width:760px;width:100%}text{font-size:11px} .borde{fill:none;stroke:#111}.agua{stroke:#064f91}</style><h1>Perfil litológico RSP-06H-C</h1><svg viewBox="0 0 760 820"><defs>${defs}</defs><rect x="90" y="70" width="180" height="675" class="borde"/>${capas}${agua}<rect x="155" y="70" width="50" height="675" class="borde"/><rect x="165" y="70" width="30" height="675" class="borde" stroke-dasharray="3 2"/>${modelo.filtros.map((f) => `<rect x="145" y="${y(f.desde_m)}" width="70" height="${y(f.hasta_m)-y(f.desde_m)}" fill="#858B91" stroke="#111"/><path d="M148 ${y(f.desde_m)+8}h14m30 0h14m-58 12h14m30 0h14" stroke="#111"/>`).join('')}</svg>`;
}
