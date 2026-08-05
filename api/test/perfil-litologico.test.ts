import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  calcularPasoEscala,
  crearPerfilLitologico,
  dibujarPerfilLitologico,
  estiloDeMaterial,
  PerfilLitologicoInvalido,
  resolverColisionesEtiquetas,
} from "../src/pdf/perfil-litologico.ts";
import { crearPDF } from "../src/pdf/pdf-generate.ts";

test("caso mínimo sin profundidad ni litología no crea perfil", () => {
  assert.equal(crearPerfilLitologico([], null), null);
});

test("una capa usa la profundidad oficial y conserva proporciones", () => {
  const perfil = crearPerfilLitologico([{ desde_m: 0, hasta_m: 20, material: "Arena" }], 40);
  assert.ok(perfil);
  assert.equal(perfil.profundidad_m, 40);
  assert.deepEqual(perfil.tramos.map((t) => [t.clase, t.desde_m, t.hasta_m]), [
    ["litologia", 0, 20],
    ["hueco", 20, 40],
  ]);
});

test("una capa menor a un metro conserva sus decimales", () => {
  const perfil = crearPerfilLitologico([{ desde_m: 0.2, hasta_m: 0.65, material: "Limo" }], 1);
  assert.ok(perfil);
  assert.equal(perfil.tramos[1].hasta_m - perfil.tramos[1].desde_m, 0.45);
});

test("ordena capas y representa todos los huecos explícitamente", () => {
  const perfil = crearPerfilLitologico([
    { desde_m: 8, hasta_m: 10, material: "Roca" },
    { desde_m: 2, hasta_m: 4, material: "Arena" },
  ], 12);
  assert.ok(perfil);
  assert.deepEqual(perfil.tramos.map((t) => [t.clase, t.desde_m, t.hasta_m]), [
    ["hueco", 0, 2], ["litologia", 2, 4], ["hueco", 4, 8], ["litologia", 8, 10], ["hueco", 10, 12],
  ]);
});

test("bloquea desde negativo, rango inverso, material vacío y solapamiento", () => {
  const casos = [
    [{ desde_m: -1, hasta_m: 2, material: "Arena" }],
    [{ desde_m: 2, hasta_m: 2, material: "Arena" }],
    [{ desde_m: 0, hasta_m: 2, material: " " }],
    [{ desde_m: 0, hasta_m: 3, material: "Arena" }, { desde_m: 2, hasta_m: 4, material: "Roca" }],
  ];
  for (const intervalos of casos) assert.throws(() => crearPerfilLitologico(intervalos, 10), PerfilLitologicoInvalido);
});

test("exige profundidad oficial y no recorta capas que la exceden", () => {
  const capa = [{ desde_m: 0, hasta_m: 12, material: "Roca" }];
  assert.throws(() => crearPerfilLitologico(capa, null), PerfilLitologicoInvalido);
  assert.throws(() => crearPerfilLitologico(capa, 10), PerfilLitologicoInvalido);
});

test("tipo desconocido obtiene patrón, tono y color deterministas", () => {
  const primero = estiloDeMaterial("Tipo ñandú desconocido");
  assert.deepEqual(primero, estiloDeMaterial("TIPO NANDU DESCONOCIDO"));
  assert.match(primero.color, /^#[0-9A-F]{6}$/);
  assert.ok(primero.gris >= 0 && primero.gris <= 1);
});

test("mantiene descripción larga como dato y no la usa para geometría", () => {
  const descripcion = "Descripción geológica extensa ".repeat(20);
  const perfil = crearPerfilLitologico([{ desde_m: 0, hasta_m: 5, material: "Arena", descripcion }], 5);
  assert.ok(perfil);
  assert.equal(perfil.tramos[0].descripcion, descripcion.trim());
});

test("sin litología conserva escala oficial y señala ausencia", () => {
  const perfil = crearPerfilLitologico([], 30);
  assert.ok(perfil);
  assert.equal(perfil.tiene_litologia, false);
  assert.equal(perfil.tramos[0].clase, "hueco");
});

test("aportes de agua quedan separados, ordenados y no crean capas", () => {
  const perfil = crearPerfilLitologico(
    [{ desde_m: 0, hasta_m: 20, material: "Roca" }],
    20,
    [{ profundidad_m: 15 }, { profundidad_m: 4 }],
  );
  assert.ok(perfil);
  assert.deepEqual(perfil.aportes.map((a) => a.profundidad_m), [4, 15]);
  assert.ok(perfil.aportes.every((a) => a.tipo === "puntual" && a.geometria.patron === "ondas"));
  assert.deepEqual(perfil.aportes[0].geometria, { x_inicio: 0.03, x_fin: 0.97, espesor_min_px: 12, patron: "ondas" });
  assert.equal(perfil.tramos.length, 1);
});

test("aporte sobre capa fina y límite conserva banda localizada determinista", () => {
  const perfil = crearPerfilLitologico([{ desde_m: 0, hasta_m: 0.5, material: "Limo" }, { desde_m: 0.5, hasta_m: 5, material: "Roca" }], 5, [{ profundidad_m: 0.25 }, { profundidad_m: 0.5 }]);
  assert.ok(perfil);
  assert.deepEqual(perfil.aportes.map((a) => [a.desde_m, a.hasta_m]), [[0.25, 0.25], [0.5, 0.5]]);
  assert.ok(perfil.aportes.every((a) => a.geometria.x_inicio < perfil.seccion_pozo.tuberia_interior_inicio && a.geometria.x_fin > perfil.seccion_pozo.tuberia_interior_fin));
});

test("modelo constructivo distingue PVC Acero y filtro ranurado con geometría compartida", () => {
  const perfil = crearPerfilLitologico([{desde_m:0,hasta_m:30,material:"Arena"}],30,[],
    [{desde_m:0,hasta_m:15,diametro_pulg:8,material_tuberia:"PVC"},{desde_m:15,hasta_m:30,diametro_pulg:6,material_tuberia:"Acero"}],
    [{desde_m:20,hasta_m:25,diametro_pulg:6,material_tuberia:"Acero"}]);
  assert.ok(perfil); assert.equal(perfil.tuberias[0].geometria.patron,"liso"); assert.equal(perfil.tuberias[1].geometria.patron,"metal");
  assert.equal(perfil.filtros[0].geometria.patron,"ranuras"); assert.equal(perfil.filtros[0].desde_m,20);
  assert.equal(perfil.filtros[0].carril_etiqueta,0);
  assert.match(perfil.etiquetas.find((e) => e.tipo === "tuberia")?.texto ?? "", /Tubería PVC · Ø 8 pulg · 0-15 m/);
  assert.match(perfil.etiquetas.find((e) => e.tipo === "filtro")?.texto ?? "", /Filtro ranurado Acero · Ø 6 pulg · 20-25 m/);
  assert.deepEqual(new Set(perfil.etiquetas.filter((e) => e.tipo !== "litologia").map((e) => e.carril)), new Set([1, 2]));
  const historico = crearPerfilLitologico([],30,[],[{desde_m:0,hasta_m:30,diametro_pulg:6,material_tuberia:null}],[]);
  assert.equal(historico?.tuberias[0].material_texto,"No especificado");
});

test("resuelve colisiones de etiquetas finas de forma pura y determinista", () => {
  const entradas = [{id:"a",preferida:.5},{id:"b",preferida:.501},{id:"c",preferida:.502}];
  const primera = resolverColisionesEtiquetas(entradas);
  assert.deepEqual(primera, resolverColisionesEtiquetas(entradas));
  assert.ok(primera[1].posicion - primera[0].posicion >= .039);
  assert.ok(primera[2].posicion - primera[1].posicion >= .039);
  assert.deepEqual(entradas.map((x) => x.preferida), [.5,.501,.502]);
});

test("tubería filtro aporte y litología cercanos reciben carriles y alturas sin solaparse", () => {
  const perfil = crearPerfilLitologico([{desde_m:0,hasta_m:49,material:"Arena"},{desde_m:49,hasta_m:61,material:"Grava"},{desde_m:61,hasta_m:100,material:"Roca"}],100,[{profundidad_m:60}],
    [{desde_m:0,hasta_m:100,diametro_pulg:6,material_tuberia:"PVC"}],[{desde_m:50,hasta_m:70,diametro_pulg:6,material_tuberia:"PVC"}]);
  assert.ok(perfil);
  assert.deepEqual(new Set(perfil.etiquetas.map((e) => e.carril)),new Set([0,1,2,3]));
  const posiciones=[...perfil.etiquetas].sort((a,b)=>a.posicion_y_normalizada-b.posicion_y_normalizada);
  assert.ok(posiciones.slice(1).every((actual,indice)=>actual.posicion_y_normalizada-posiciones[indice].posicion_y_normalizada>=.039));
});

test("pozo profundo y muchas capas finas generan rangos multipágina", () => {
  const capas = Array.from({ length: 80 }, (_, i) => ({ desde_m: i * 0.5, hasta_m: (i + 1) * 0.5, material: `Material ${i}` }));
  const perfil = crearPerfilLitologico(capas, 420);
  assert.ok(perfil);
  assert.ok(perfil.rangos.length >= 5);
  assert.equal(perfil.rangos[0].desde_m, 0);
  assert.equal(perfil.rangos.at(-1)?.hasta_m, 420);
  assert.ok(new Set(perfil.tramos.map((t) => t.carril_etiqueta)).size > 1);
});

test("adapta las marcas automáticas", () => {
  assert.equal(calcularPasoEscala(20), 2);
  assert.equal(calcularPasoEscala(100), 10);
  assert.equal(calcularPasoEscala(600), 100);
});

test("el adaptador PDF crea exactamente una página por rango", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const capas = Array.from({ length: 40 }, (_, i) => ({ desde_m: i, hasta_m: i + 1, material: `Capa ${i}` }));
  const perfil = crearPerfilLitologico(capas, 240, [{ profundidad_m: 12 }]);
  assert.ok(perfil);
  const paginas = dibujarPerfilLitologico(doc, perfil, font, bold);
  const bytes = await doc.save();
  assert.equal(paginas.length, perfil.rangos.length);
  assert.equal(doc.getPageCount(), perfil.rangos.length);
  assert.ok(bytes.length > 2_000);
});

test("el informe completo conserva sus secciones y agrega todas las páginas del perfil", async () => {
  const litologia = Array.from({ length: 37 }, (_, i) => ({ desde_m: i, hasta_m: i + 1, material: i === 0 ? "Arena fina con grava y fragmentos de roca sedimentaria de descripción extensa" : `Estrato ${i}` }));
  const reporte = {
    id_pozo: 7,
    propietario: "Propietario",
    empresa: "Empresa",
    perforador: "Perforador",
    sitio: "Montevideo",
    fecha_inicio: null,
    fecha_fin: null,
    profundidad_final_m: 220,
    nivel_estatico_m: null,
    nivel_dinamico_m: null,
    caudal_estimado_lh: null,
    metodo_sedimentario: null,
    metodo_rocoso: null,
    cementacion: null,
    desarrollo: null,
    introduccion: null,
    nombre_archivo: null,
    foto_url: null,
    litologia,
    diametros: [],
    niveles_aporte: [{ profundidad_m: 12 }],
  };
  const perfil = crearPerfilLitologico(litologia, reporte.profundidad_final_m, reporte.niveles_aporte);
  assert.ok(perfil);
  const doc = await crearPDF(reporte, 7);
  assert.ok(doc.getPageCount() >= perfil.rangos.length + 1);
  assert.ok((await doc.save()).length > 5_000);
});
