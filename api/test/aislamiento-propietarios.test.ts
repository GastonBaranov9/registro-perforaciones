import assert from "node:assert/strict";
import test from "node:test";
import {
  pozoPerteneceAPerforador,
  pozoPerteneceAUsuario,
  sitioEsVisibleParaPropietario,
} from "../src/services/autorizacion-recursos.ts";

function dbConRelaciones(relaciones: ReadonlySet<string>) {
  return {
    async query(_sql: string, params?: unknown[]) {
      const clave = `${params?.[0]}:${params?.[1]}`;
      return { rowCount: relaciones.has(clave) ? 1 : 0 };
    },
  };
}

test("un propietario solo valida sus pozos aunque cambie el ID", async () => {
  const db = dbConRelaciones(new Set(["10:1"]));
  assert.equal(await pozoPerteneceAUsuario(10, 1, db), true);
  assert.equal(await pozoPerteneceAUsuario(20, 1, db), false);
});

test("la comprobacion del perforador usa su relacion persistente", async () => {
  const db = dbConRelaciones(new Set(["10:3"]));
  assert.equal(await pozoPerteneceAPerforador(10, 3, db), true);
  assert.equal(await pozoPerteneceAPerforador(10, 4, db), false);
});

test("un sitio solo es visible si existe un pozo propio asociado", async () => {
  const db = dbConRelaciones(new Set(["7:1"]));
  assert.equal(await sitioEsVisibleParaPropietario(7, 1, db), true);
  assert.equal(await sitioEsVisibleParaPropietario(8, 1, db), false);
});
