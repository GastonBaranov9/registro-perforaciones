import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("el preview arbitrario exige el contrato de edición y no habilita propietarios", async () => {
  const fuente = await readFile(new URL("../src/routes/sitios.ts", import.meta.url), "utf8");
  const inicio = fuente.indexOf("/usuarios/:id_usuario/sitios/:id_sitio/mapa-aereo/preview");
  const fin = fuente.indexOf("/usuarios/:id_usuario/sitios/:id_sitio/mapa-aereo\"", inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  const preview = fuente.slice(inicio, fin);
  assert.match(preview, /preHandler: \[fastify\.userIsAdminOrPerforador\]/);
  assert.match(preview, /sitioEsGestionablePorPerforador\(id_sitio, req\.user\.sub\)/);
  assert.doesNotMatch(preview, /rolUser\(req\.user\.sub,\s*["']propietario/);
  assert.match(preview, /obtenerMapaEstatico/);
});
