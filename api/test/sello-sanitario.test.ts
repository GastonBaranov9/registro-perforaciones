import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { crearPerfilLitologico, obtenerEntradasLeyendaLitologica } from '../src/pdf/perfil-litologico.ts';
import { crearPDFConDiagnostico } from '../src/pdf/pdf-generate.ts';
import { PatronesLitologia } from '../src/models/schemas.ts';
import { leerMigraciones } from '../src/db/migrator.ts';
import { myPool } from '../src/db/pool.ts';
import { listarLitologias, obtenerLitologia } from '../src/services/litologias-services.ts';
import type { ReportePozo } from '../src/services/generar-informe-consultas.ts';

export const sello = { desde_m: 0, hasta_m: 3.5, material: 'Sello sanitario', id_litologia: 30, litologia_nombre: 'Sello sanitario', litologia_color: '#999999', litologia_patron: 'concrete' as const, litologia_activa: true };
test('010 es descubierta después de 009 y corrige sólo la clasificación de Sello sanitario', async () => {
  const migraciones = await leerMigraciones();
  assert.deepEqual(migraciones.filter(m => m.version <= "010").map(m => m.version), Array.from({ length: 11 }, (_, i) => String(i).padStart(3, '0')));
  const correccion = migraciones.find(m => m.version === "010")!;
  assert.equal(correccion.archivo, '010_sello_sanitario_no_inicial.sql');
  assert.match(correccion.sql.replace(/--[^\n]*/g, '').trim(), /^UPDATE catalogo_litologia\s+SET es_inicial = FALSE\s+WHERE codigo = 'sello_sanitario'\s+AND es_inicial = TRUE;$/);
});
test('Sello sanitario activo y no inicial sigue disponible en el catálogo público y por id', async (t) => {
  const fila = { id_litologia: 30, codigo: 'sello_sanitario', nombre: 'Sello sanitario', familia: 'otro', color: '#999999', patron: 'concrete', activo: true, orden: 30, es_inicial: false };
  const { es_inicial, ...publica } = fila;
  assert.equal(es_inicial, false);
  t.mock.method(myPool, 'query', async (sql: string, valores: unknown[]) => {
    assert.doesNotMatch(sql, /es_inicial/);
    if (sql.includes('WHERE activo')) {
      assert.deepEqual(valores, [false]);
    } else {
      assert.match(sql, /WHERE id_litologia=\$1/);
      assert.deepEqual(valores, [30]);
    }
    return { rows: [publica] };
  });
  assert.deepEqual(await listarLitologias(), [publica]);
  assert.deepEqual(await obtenerLitologia(30), publica);
});
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
