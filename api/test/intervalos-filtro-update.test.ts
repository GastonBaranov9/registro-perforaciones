import test from "node:test";
import assert from "node:assert/strict";
import { actualizarFiltro } from "../src/services/intervalos-filtro-service.ts";

const valido = { desde_m:10,hasta_m:20,diametro_pulg:6,material_tuberia:"PVC" as const };
function dbCon(filas: Record<string,unknown>[][]) {
  let indice=0;
  return { query:async()=>({rows:filas[indice++] ?? []}) };
}

test("filtro inexistente o ajeno conserva el 404 genérico mediante null", async()=>{
  assert.equal(await actualizarFiltro(1,99,valido,dbCon([[]])),null);
});

test("rechaza rango diámetro y material inválidos antes de consultar", async()=>{
  for(const dato of [
    {...valido,desde_m:20,hasta_m:10},
    {...valido,diametro_pulg:0},
    {...valido,material_tuberia:"Madera" as "PVC"},
  ]) await assert.rejects(actualizarFiltro(1,2,dato,dbCon([])),(error:unknown)=>typeof error==="object"&&error!==null&&"statusCode" in error&&error.statusCode===400);
});

test("distingue profundidad y solapamiento como datos incorrectos", async()=>{
  await assert.rejects(actualizarFiltro(1,2,{...valido,hasta_m:31},dbCon([[{id_intervalo_filtro:2}],[{profundidad_final_m:30}]])),/profundidad/);
  await assert.rejects(actualizarFiltro(1,2,valido,dbCon([[{id_intervalo_filtro:2}],[{profundidad_final_m:30}],[{id_intervalo_filtro:3}]])),/solapa/);
});

test("excluye el propio intervalo y actualiza después de validar", async()=>{
  const fila={id_intervalo_filtro:2,id_pozo:1,...valido};
  const actualizado=await actualizarFiltro(1,2,valido,dbCon([[{id_intervalo_filtro:2}],[{profundidad_final_m:30}],[],[fila]]));
  assert.deepEqual(actualizado,fila);
});

test("la defensa atómica convierte una carrera en 400 y no en 404", async()=>{
  await assert.rejects(actualizarFiltro(1,2,valido,dbCon([[{id_intervalo_filtro:2}],[{profundidad_final_m:30}],[],[]])),/solapa o excede/);
});
