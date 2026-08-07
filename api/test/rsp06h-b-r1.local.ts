import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { myPool } from "../src/db/pool.ts";
import { actualizarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { createIntervaloLitologico, updateIntervaloLitologico, listIntervalosLitologicosByPozo } from "../src/services/intervalos-litologicos-services.ts";
import { crearPerfilLitologico } from "../src/pdf/perfil-litologico.ts";
import { crearPDF } from "../src/pdf/pdf-generate.ts";

const cuatrocientos = (promesa: Promise<unknown>) => assert.rejects(promesa, (e: unknown) => e instanceof Error && (e as Error & { statusCode?: number }).statusCode === 400);
const sufijo = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const codigo = `control_r1_${sufijo}`;
let usuarioId: number | undefined;
let sitioId: number | undefined;
let pozoId: number | undefined;
let litologiaInactiva: number | undefined;
let litologiaActiva: number | undefined;
let intervaloInactivo: number | undefined;
let intervaloActivo: number | undefined;
let intervaloHistorico: number | undefined;
const fotos = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06h-b-r1-"));

try {
  const [{ rows: usuarioRows }, { rows: catalogoRows }] = await Promise.all([
    myPool.query<{ id_usuario: number }>("INSERT INTO usuario(email,nombre,password,activo) VALUES($1,$2,$3,TRUE) RETURNING id_usuario", [`r1-${sufijo}@example.invalid`, "Control R1", "sin-login"]),
    myPool.query<{ id_litologia: number }>("INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden) VALUES($1,$2,'otro','#6B625A','granite',999) RETURNING id_litologia", [codigo, `Litología R1 ${sufijo}`]),
  ]);
  usuarioId = Number(usuarioRows[0].id_usuario); litologiaInactiva = Number(catalogoRows[0].id_litologia);
  const { rows: roles } = await myPool.query<{ id_rol: number }>("SELECT id_rol FROM rol WHERE nombre IN ('propietario','perforador') ORDER BY nombre");
  for (const rol of roles) await myPool.query("INSERT INTO usuario_rol(id_usuario,id_rol) VALUES($1,$2)", [usuarioId, rol.id_rol]);
  const { rows: activaRows } = await myPool.query<{ id_litologia: number }>("SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'");
  litologiaActiva = Number(activaRows[0].id_litologia);
  const { rows: sitioRows } = await myPool.query<{ id_sitio: number }>("INSERT INTO sitio(departamento,localidad) VALUES('Control R1','Temporal') RETURNING id_sitio", []);
  sitioId = Number(sitioRows[0].id_sitio);
  const { rows: pozoRows } = await myPool.query<{ id_pozo: number }>("INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,profundidad_final_m) VALUES($1,$2,$1,$1,40) RETURNING id_pozo", [usuarioId, sitioId]);
  pozoId = Number(pozoRows[0].id_pozo);

  const creado = await createIntervaloLitologico(pozoId, { desde_m: 0, hasta_m: 10, material: "Control", id_litologia: litologiaInactiva });
  intervaloInactivo = Number(creado.id_intervalo_litologico);
  await myPool.query("UPDATE catalogo_litologia SET activo=FALSE WHERE id_litologia=$1", [litologiaInactiva]);
  await cuatrocientos(createIntervaloLitologico(pozoId!, { desde_m: 30, hasta_m: 40, material: "Control", id_litologia: litologiaInactiva }));
  const creadoActivo = await createIntervaloLitologico(pozoId!, { desde_m: 10, hasta_m: 20, material: "Control", id_litologia: litologiaActiva });
  intervaloActivo = Number(creadoActivo.id_intervalo_litologico);
  const { rows: historicoRows } = await myPool.query<{ id_intervalo_litologico: number }>("INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material) VALUES($1,20,30,'Material histórico R1') RETURNING id_intervalo_litologico", [pozoId]);
  intervaloHistorico = Number(historicoRows[0].id_intervalo_litologico);
  const conservado = await updateIntervaloLitologico(pozoId!, intervaloInactivo!, { desde_m: 0, hasta_m: 9, material: "Control histórico", id_litologia: litologiaInactiva });
  assert.equal(Number(conservado.id_litologia), litologiaInactiva);
  await cuatrocientos(updateIntervaloLitologico(pozoId!, intervaloActivo!, { desde_m: 10, hasta_m: 19, material: "Intento", id_litologia: litologiaInactiva }));
  const sinVinculo = await updateIntervaloLitologico(pozoId!, intervaloHistorico!, { desde_m: 20, hasta_m: 29, material: "Material histórico R1" });
  assert.equal(sinVinculo.id_litologia, null);
  const vinculado = await updateIntervaloLitologico(pozoId!, intervaloHistorico!, { desde_m: 20, hasta_m: 29, material: "Arenisca fina", id_litologia: litologiaActiva });
  assert.equal(Number(vinculado.id_litologia), litologiaActiva);

  const completo = await actualizarPozoCompleto(pozoId!, {
    pozo: { id_propietario: usuarioId!, id_sitio: sitioId!, id_perforador: usuarioId!, profundidad_final_m: 40 },
    intervalos_litologicos: [{ id_intervalo_litologico: intervaloInactivo, desde_m: 0, hasta_m: 8, material: "Control histórico", id_litologia: litologiaInactiva }, { id_intervalo_litologico: intervaloActivo, desde_m: 9, hasta_m: 19, material: "Arenisca fina", id_litologia: litologiaActiva }, { id_intervalo_litologico: intervaloHistorico, desde_m: 20, hasta_m: 29, material: "Arenisca fina", id_litologia: litologiaActiva }],
    intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
  }, fotos);
  assert.equal(Number(completo.intervalos_litologicos.find((x) => x.id_litologia === litologiaInactiva)?.id_litologia), litologiaInactiva);
  const lista = await listIntervalosLitologicosByPozo(pozoId!);
  const litologiaReporte = lista.map((x) => ({ desde_m: Number(x.desde_m), hasta_m: Number(x.hasta_m), material: String(x.material), id_litologia: x.id_litologia == null ? null : Number(x.id_litologia), litologia_nombre: x.litologia_nombre == null ? null : String(x.litologia_nombre), litologia_color: x.litologia_color == null ? null : String(x.litologia_color), litologia_patron: x.litologia_patron, litologia_activa: x.litologia_activa == null ? null : Boolean(x.litologia_activa) }));
  const perfil = crearPerfilLitologico(litologiaReporte, 40);
  assert.ok(perfil);
  const pdf = await crearPDF({ id_pozo: pozoId!, propietario: "Control", empresa: "R1", perforador: "Control", sitio: "Temporal", fecha_inicio: null, fecha_fin: null, profundidad_final_m: 40, nivel_estatico_m: null, nivel_dinamico_m: null, caudal_estimado_lh: null, metodo_sedimentario: null, metodo_rocoso: null, cementacion: null, desarrollo: null, introduccion: null, nombre_archivo: null, foto_url: null, litologia: litologiaReporte, diametros: [], filtros: [], niveles_aporte: [] }, pozoId!, { mapa: {} });
  assert.ok((await pdf.save()).byteLength > 1000);
  console.log(JSON.stringify({ creacion_inactiva: 400, standalone_misma_inactiva: true, standalone_distinta_inactiva: 400, historico_null: true, completo_misma_inactiva: true, perfil: true, pdf: true }));
} finally {
  if (pozoId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoId]);
  if (sitioId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioId]);
  if (usuarioId) { await myPool.query("DELETE FROM usuario_rol WHERE id_usuario=$1", [usuarioId]); await myPool.query("DELETE FROM usuario WHERE id_usuario=$1", [usuarioId]); }
  if (litologiaInactiva) await myPool.query("DELETE FROM catalogo_litologia WHERE id_litologia=$1", [litologiaInactiva]);
  await fs.rm(fotos, { recursive: true, force: true });
  await myPool.end();
}
