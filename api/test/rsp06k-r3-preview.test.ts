import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { leerCoordenadas } from "../src/pdf/mapa-estatico.ts";

test("el contrato de preview usa coordenadas validadas y no acepta un proxy abierto", async () => {
  const fuente = await readFile(new URL("../src/routes/sitios.ts", import.meta.url), "utf8");
  assert.match(fuente, /\/usuarios\/:id_usuario\/sitios\/:id_sitio\/mapa-aereo\/preview/);
  assert.match(fuente, /querystring: Type\.Object\(\{ latitud: Type\.String\(\), longitud: Type\.String\(\) \}\)/);
  assert.match(fuente, /leerCoordenadas\(latitud, longitud\)/);
  assert.match(fuente, /sitioEsGestionablePorPerforador\(id_sitio, req\.user\.sub\)/);
  assert.match(fuente, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(fuente, /req\.query\.(url|host|apiKey)/);
});

test("el preview normaliza el punto pendiente y rechaza coordenadas inválidas", () => {
  assert.deepEqual(leerCoordenadas("-31.443917", "-57.986556"), { latitud: -31.443917, longitud: -57.986556 });
  assert.deepEqual(leerCoordenadas("31°26'38.1\"S", "57°59'11.6\"W"), { latitud: -31.4439167, longitud: -57.9865556 });
  assert.equal(leerCoordenadas("91", "-57"), null);
  assert.equal(leerCoordenadas("-31", "Infinity"), null);
});
