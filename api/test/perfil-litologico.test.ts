import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  calcularPasoEscala,
  colorDeMaterial,
  crearPerfilLitologico,
  dibujarPerfilLitologico,
} from "../src/pdf/perfil-litologico.ts";

test("construye un perfil ordenado y usa la mayor profundidad real", () => {
  const perfil = crearPerfilLitologico(
    [
      { desde_m: 20, hasta_m: 45, material: "Roca" },
      { desde_m: 0, hasta_m: 20, material: "Arena" },
    ],
    40,
  );

  assert.ok(perfil);
  assert.equal(perfil.profundidad_m, 45);
  assert.deepEqual(perfil.tramos.map((tramo) => tramo.desde_m), [0, 20]);
  assert.equal(perfil.paso_escala_m, 5);
});

test("representa la profundidad declarada incluso cuando hay huecos", () => {
  const perfil = crearPerfilLitologico(
    [{ desde_m: 10, hasta_m: 20, material: "Arcilla" }],
    80,
  );

  assert.ok(perfil);
  assert.equal(perfil.profundidad_m, 80);
  assert.equal(perfil.paso_escala_m, 10);
});

test("descarta intervalos invalidos sin alterar los datos originales", () => {
  const intervalos = [
    { desde_m: 8, hasta_m: 3, material: "Roca" },
    { desde_m: 0, hasta_m: 5, material: "  " },
  ];
  const perfil = crearPerfilLitologico(intervalos, 12);

  assert.ok(perfil);
  assert.deepEqual(perfil.tramos, []);
  assert.deepEqual(intervalos[0], { desde_m: 8, hasta_m: 3, material: "Roca" });
  assert.equal(crearPerfilLitologico([], null), null);
});

test("el color de un material es estable y no depende de mayusculas o tildes", () => {
  assert.deepEqual(colorDeMaterial("ÁRCILLA"), colorDeMaterial("arcilla"));
  assert.deepEqual(colorDeMaterial(" Arena "), colorDeMaterial("arena"));
});

test("adapta la escala a perfiles someros y profundos", () => {
  assert.equal(calcularPasoEscala(20), 2);
  assert.equal(calcularPasoEscala(100), 10);
  assert.equal(calcularPasoEscala(600), 100);
});

test("dibuja el perfil como una pagina PDF adicional", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const perfil = crearPerfilLitologico(
    [{ desde_m: 0, hasta_m: 30, material: "Arena" }],
    30,
  );

  assert.ok(perfil);
  dibujarPerfilLitologico(doc, perfil, font, bold);
  const bytes = await doc.save();

  assert.equal(doc.getPageCount(), 1);
  assert.ok(bytes.length > 500);
});
