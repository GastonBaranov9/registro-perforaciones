import assert from "node:assert/strict";
import test from "node:test";
import * as err from "../src/models/errors.ts";
import { traducirErrorPostgres } from "../src/services/intervalos-litologicos-services.ts";

test("preserva sin mutar errores de dominio",()=>{const dominio=new err.T05DatosIncorrectos("Solapamiento controlado");const traducido=traducirErrorPostgres(dominio);assert.equal(traducido,dominio);assert.equal(dominio.statusCode,400);assert.match(dominio.message,/Solapamiento/);});
test("traduce restricciones PostgreSQL reales a error seguro 400",()=>{const traducido=traducirErrorPostgres(Object.assign(new Error("detalle interno"),{code:"23514"}));assert.ok(traducido instanceof Error);assert.equal((traducido as Error&{statusCode:number}).statusCode,400);assert.doesNotMatch((traducido as Error).message,/detalle interno/);});
test("conserva errores inesperados para el manejador 500",()=>{const inesperado=new Error("fallo inesperado");assert.equal(traducirErrorPostgres(inesperado),inesperado);});
