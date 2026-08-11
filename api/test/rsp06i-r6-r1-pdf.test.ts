import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

function casoManual(): ReportePozo {
  return {
    id_pozo: 6061, propietario: "Control visual R6-R1", empresa: "Empresa", perforador: "Perforador",
    sitio: "Salto", departamento: "Salto", localidad: "Salto", latitud: "-31", longitud: "-57",
    fecha_inicio: "2026-08-11", fecha_fin: "2026-08-11", profundidad_final_m: 100,
    nivel_estatico_m: 8, nivel_dinamico_m: 12, caudal_estimado_lh: 1500,
    metodo_sedimentario: "Rotación", metodo_rocoso: "Percusión", cementacion: "Sí", desarrollo: "Registrado",
    introduccion: null, nombre_archivo: null, foto_url: null,
    litologia: [
      { desde_m: 0, hasta_m: 10, material: "Sello sanitario" },
      { desde_m: 10, hasta_m: 40, material: "Tosca rosada" },
      { desde_m: 40, hasta_m: 100, material: "Arena arcillosa" },
    ],
    diametros: [
      { desde_m: 0, hasta_m: 10, diametro_pulg: 8, material_tuberia: "PVC" },
      { desde_m: 10, hasta_m: 100, diametro_pulg: 6, material_tuberia: "PVC" },
    ],
    filtros: [], niveles_aporte: [{ profundidad_m: 70 }],
  };
}

function cerca(actual:number,esperado:number) {
  assert.ok(Math.abs(actual-esperado)<.001, `Se esperaban ${esperado} pt y se midieron ${actual} pt`);
}

test("R6-R1 mide cajas visuales en el caso manual exacto",async()=>{
  const {documento,diagnostico}=await crearPDFConDiagnostico(casoManual(),6061,{mapa:{}});
  const [litologia,tuberias,filtros,aportes]=diagnostico.tablas;
  assert.equal(diagnostico.paginas.filter((pagina)=>pagina.tipo.startsWith("tecnica")).length,1);
  assert.deepEqual(diagnostico.tablas.map((tabla)=>tabla.paginaTitulo),[2,2,2,2]);

  cerca(litologia.bordeInferiorFinal-tuberias.tituloTop,12);
  cerca(tuberias.bordeInferiorFinal-filtros.tituloTop,12);
  cerca(filtros.bordeInferiorFinal-aportes.tituloTop,12);
  assert.ok(litologia.bordeInferiorFinal>tuberias.tituloTop);
  assert.ok(tuberias.bordeInferiorFinal>filtros.tituloTop);
  assert.ok(filtros.bordeInferiorFinal>aportes.tituloTop);
  diagnostico.tablas.forEach((tabla)=>{
    assert.ok(tabla.tituloTop>(tabla.lineaBaseTitulo??Number.POSITIVE_INFINITY));
    assert.ok(tabla.tituloBottom<(tabla.lineaBaseTitulo??Number.NEGATIVE_INFINITY));
    assert.equal(tabla.tituloTop-tabla.tituloBottom,(tabla.ascensoVisualTitulo??0)+(tabla.descensoVisualTitulo??0));
  });
  diagnostico.tablas.forEach((tabla)=>cerca(tabla.tituloBottom-tabla.contenidoTop,7));
  assert.equal(filtros.alturasFilas.length,0);
  assert.ok(diagnostico.tablas.every((tabla)=>(tabla.fuente??0)>=9));
  assert.ok(diagnostico.tablas.every((tabla)=>tabla.bordeInferiorFinal>=52));
  const bytes=await documento.save();assert.ok(bytes.length>1_000);
  if(process.env.RSP06I_R6_R1_PDF_PATH)await fs.writeFile(process.env.RSP06I_R6_R1_PDF_PATH,bytes);

  console.log(JSON.stringify({
    evidencia:"RSP-06I-R6-R1",fuente_tabla:litologia.fuente,fuente_titulo:12,
    litologia_bottom:litologia.bordeInferiorFinal,tuberias_title_top:tuberias.tituloTop,gap_litologia_tuberias:litologia.bordeInferiorFinal-tuberias.tituloTop,
    tuberias_bottom:tuberias.bordeInferiorFinal,filtros_title_top:filtros.tituloTop,gap_tuberias_filtros:tuberias.bordeInferiorFinal-filtros.tituloTop,
    sin_registros_bottom:filtros.bordeInferiorFinal,aportes_title_top:aportes.tituloTop,gap_sin_registros_aportes:filtros.bordeInferiorFinal-aportes.tituloTop,
    gaps_post_titulo:diagnostico.tablas.map((tabla)=>tabla.tituloBottom-tabla.contenidoTop),paginas:diagnostico.tablas.map((tabla)=>tabla.paginaTitulo+1),
  }));
});
