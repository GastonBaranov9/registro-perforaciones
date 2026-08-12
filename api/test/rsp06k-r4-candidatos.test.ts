import assert from "node:assert/strict";
import test from "node:test";
import { listarCandidatosPozo } from "../src/services/candidatos-pozo-service.ts";

function db() {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  return {
    consultas,
    cliente: { async query(sql: string, params: unknown[]) {
      consultas.push({ sql, params });
      return { rows: [{ id_usuario: 9, nombre: "A", email: null, roles: ["propietario"] }] };
    } },
  };
}

test("busca propietarios con un carácter y no enumera con vacío o whitespace", async () => {
  const uno = db();
  const resultado = await listarCandidatosPozo(8, false, uno.cliente, { propietario: "A" });
  assert.equal(resultado.propietarios[0]?.nombre, "A");
  assert.equal(uno.consultas.length, 2);
  assert.equal(uno.consultas[0].params[3], "A");

  const vacio = db();
  const resultadoVacio = await listarCandidatosPozo(8, false, vacio.cliente, { propietario: "" });
  assert.deepEqual(resultadoVacio.propietarios, []);
  assert.equal(vacio.consultas.length, 1);
  assert.equal(vacio.consultas[0].params[3], null);

  const espacios = db();
  const resultadoEspacios = await listarCandidatosPozo(8, true, espacios.cliente, { propietario: "   " });
  assert.deepEqual(resultadoEspacios.propietarios, []);
  assert.deepEqual(resultadoEspacios.perforadores, []);
  assert.equal(espacios.consultas.length, 0);
});
