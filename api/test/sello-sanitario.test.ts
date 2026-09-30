import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { crearPerfilLitologico, obtenerEntradasLeyendaLitologica } from '../src/pdf/perfil-litologico.ts';
import { crearPDFConDiagnostico } from '../src/pdf/pdf-generate.ts';
import { PatronesLitologia } from '../src/models/schemas.ts';
import type { ReportePozo } from '../src/services/generar-informe-consultas.ts';

export const sello = { desde_m: 0, hasta_m: 3.5, material: 'Sello sanitario', id_litologia: 30, litologia_nombre: 'Sello sanitario', litologia_color: '#999999', litologia_patron: 'concrete' as const, litologia_activa: true };
test('009 incorpora un material independiente con conflicto controlado y constraint compatible', () => {
  const sql = readFileSync(new URL('../db/migrations/009_sello_sanitario.sql', import.meta.url), 'utf8');
  assert.match(sql, /ON CONFLICT \(codigo\) DO NOTHING/);
  assert.match(sql, /'sello_sanitario','Sello sanitario','otro','#999999','concrete'/);
  assert.doesNotMatch(sql, /UPDATE\s+(pozo|intervalo_litologico)/i);
  for (const patron of PatronesLitologia) assert.ok(sql.includes(`'${patron}'`));
});
test('Sello sanitario respeta profundidad editable, conserva históricos y representa moteado gris', () => {
  const perfil = crearPerfilLitologico([sello, { desde_m: 3.5, hasta_m: 30, material: 'Basalto histórico' }], 30)!;
  assert.equal(perfil.tramos[0].hasta_m, 3.5);
  assert.deepEqual(perfil.tramos[0].estilo, { color: '#999999', gris: 0.6, patron: 'concrete' });
  assert.equal(perfil.tramos[1].material, 'Basalto histórico');
  assert.equal(obtenerEntradasLeyendaLitologica(perfil)[0].nombre, 'Sello sanitario');
});
test('PDF completo compone Sello sanitario junto a portada, ubicación y técnica', async () => {
  const reporte = { id_pozo: 1, propietario: 'Prueba', perforador: 'Prueba', empresa: 'Raúl Silva', sitio: 'Salto', departamento: 'Salto', localidad: 'Salto', profundidad_final_m: 30, litologia: [sello], diametros: [], filtros: [], niveles_aporte: [], foto_url: null } as unknown as ReportePozo;
  const { documento, diagnostico } = await crearPDFConDiagnostico(reporte, 1, { mapa: {} });
  assert.deepEqual(diagnostico.paginas.slice(0, 3).map(p => p.tipo), ['portada', 'ubicacion', 'tecnica']);
  const bytes = await documento.save();
  assert.ok(bytes.length > 1000);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 4);
});
