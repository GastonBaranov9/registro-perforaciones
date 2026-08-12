import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sitioTienePozos } from "../src/services/sitios-service.ts";

test("DELETE de sitio queda reservado a administración y protege la FK", async () => {
  const fuente = await readFile(new URL("../src/routes/sitios.ts", import.meta.url), "utf8");
  const deleteRoute = fuente.indexOf("fastify.delete(");
  const inicio = fuente.indexOf("/usuarios/:id_usuario/sitios/:id_sitio\"", deleteRoute);
  const fin = fuente.indexOf("//Obtener un sitio", inicio);
  const borrar = fuente.slice(inicio, fin);
  assert.match(borrar, /if \(\!\(await isAdmin\(req\.user\.sub\)\)\) throw new err\.T05SinPermiso/);
  assert.match(borrar, /sitioTienePozos\(id_sitio\)/);
  assert.match(borrar, /T05IntegridadReferencial/);
  assert.doesNotMatch(borrar, /sitioEsGestionablePorPerforador\(id_sitio,req\.user\.sub\)/);
});

test("el listado solo expone Borrar para administración", async () => {
  const fuente = await readFile(new URL("../../front/src/app/routes/sitios/pages/sitios-list/sitios-list.page.html", import.meta.url), "utf8");
  assert.match(fuente, /tieneRol\('administracion'\)/);
});

test("la comprobación de integridad diferencia sitios referenciados y libres", async () => {
  const conPozo = { async query() { return { rowCount: 1 }; } };
  const sinPozo = { async query() { return { rowCount: 0 }; } };
  assert.equal(await sitioTienePozos(10, conPozo), true);
  assert.equal(await sitioTienePozos(11, sinPozo), false);
});
