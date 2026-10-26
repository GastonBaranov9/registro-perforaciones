import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFPage, StandardFonts } from 'pdf-lib';
import { Value } from '@sinclair/typebox/value';
import { PrefiltroOpcional } from '../src/models/schemas.ts';
import { validarPrefiltro } from '../src/services/prefiltro-service.ts';
import { crearPerfilLitologico, dibujarPerfilLitologico, ESPESOR_GRAFICO_SELLO, ESPESOR_GRAFICO_PREFILTRO, transformarPuntoCanonicoPdf } from '../src/pdf/perfil-litologico.ts';

const rango = (desde_m:number,hasta_m:number) => ({desde_m,hasta_m});
const roca = [{...rango(0,240),material:'Basalto'}];
const tubos = [{...rango(0,20),diametro_pulg:8,material_tuberia:'PVC' as const},
  {...rango(20,240),diametro_pulg:6,material_tuberia:'Acero' as const}];
const filtro = [{...rango(13.5,15.5),diametro_pulg:8,material_tuberia:'PVC' as const}];

for (const valor of [undefined,null,[],[rango(13.5,15.5),rango(20,25)],[rango(4,6),rango(0,4)]])
  test('prefiltro opcional y consecutivo: '+JSON.stringify(valor),()=>assert.doesNotThrow(()=>validarPrefiltro(valor,30)));
for (const valor of [[rango(-1,2)],[rango(2,2)],[rango(4,2)],[rango(0,Infinity)],[rango(NaN,2)],
  [rango(0,31)],[rango(0,4),rango(3,5)],[rango(0,4),rango(0,4)]])
  test('rechaza intervalo inválido: '+JSON.stringify(valor),()=>assert.throws(()=>validarPrefiltro(valor,30)));
test('exige profundidad conocida y rechaza propiedades ajenas',()=>{
  assert.throws(()=>validarPrefiltro([rango(0,1)]));
  assert.equal(Value.Check(PrefiltroOpcional,[{...rango(0,1),diametro:8}]),false);
});

test('sello más angosto, visible, en contacto y adaptable; terreno intacto',()=>{
  const p=crearPerfilLitologico(roca,240,[],tubos,[],rango(5,25))!;
  assert.equal(p.tramos.length,1); assert.equal(p.tramos[0].hasta_m,240);
  assert.deepEqual(p.sello_sanitario_constructivo!.geometria.segmentos.map(s=>rango(s.desde_m,s.hasta_m)),[rango(5,20),rango(20,25)]);
  for(const [i,s] of p.sello_sanitario_constructivo!.geometria.segmentos.entries()){
    assert.equal(s.bandas[0].x_fin,p.tuberias[i].geometria.x_inicio);
    assert.equal(s.bandas[1].x_inicio,p.tuberias[i].geometria.x_fin);
    assert.ok(Math.abs(s.bandas[0].x_fin-s.bandas[0].x_inicio-ESPESOR_GRAFICO_SELLO)<1e-10);
    assert.ok(s.bandas[0].x_inicio>.06); assert.ok(s.bandas[1].x_fin<.94);
  }
});
for(const [nombre,sello,prefiltros,filtros] of [
  ['sólo sello',rango(0,10),[],[]],
  ['prefiltro y filtro',null,[rango(13.5,15.5)],filtro],
  ['adyacentes',rango(0,13.5),[rango(13.5,15.5),rango(20,25)],filtro],
  ['sin ambos',null,[],[]],
  ['solapados',rango(0,15),[rango(13.5,15.5)],filtro],
  ['multipágina',rango(0,10),[rango(20,225)],filtro],
] as const) test(nombre+': profundidades, etiquetas, paginación y PDF compartidos',async t=>{
  const p=crearPerfilLitologico(roca,240,[],tubos,[...filtros],sello,[...prefiltros])!;
  assert.deepEqual(p.prefiltro_constructivo.map(s=>rango(s.desde_m,s.hasta_m)),prefiltros);
  assert.equal(p.etiquetas.filter(e=>e.tipo==='prefiltro').length,prefiltros.length);
  if(nombre==='solapados'){
    assert.ok(p.advertencias.some(a=>a.includes('coinciden')));
    const seal=p.sello_sanitario_constructivo!.geometria.bandas;
    const gravel=p.prefiltro_constructivo[0].geometria.segmentos[0].bandas;
    assert.equal(gravel[0].x_fin,seal[0].x_inicio);assert.equal(gravel[1].x_inicio,seal[1].x_fin);
  }
  for(const r of p.rangos){
    const etiquetas=p.etiquetas.filter(e=>e.rango_desde_m===r.desde_m).sort((a,b)=>a.posicion_y_normalizada-b.posicion_y_normalizada);
    for(let i=1;i<etiquetas.length;i++)assert.ok(etiquetas[i].posicion_y_normalizada-etiquetas[i-1].posicion_y_normalizada>=.054);
  }
  const draw=t.mock.method(PDFPage.prototype,'drawRectangle');
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  dibujarPerfilLitologico(doc,p,font,bold);
  for(const pre of p.prefiltro_constructivo) for(const seg of pre.geometria.segmentos) for(const r of p.rangos){
    const desde=Math.max(seg.desde_m,r.desde_m),hasta=Math.min(seg.hasta_m,r.hasta_m);if(hasta<=desde)continue;
    const y=(m:number)=>transformarPuntoCanonicoPdf({x_normalizada:0,y_normalizada:(70+(m-r.desde_m)/(r.hasta_m-r.desde_m)*700)/820}).y;
    for(const banda of seg.bandas){
      const x=transformarPuntoCanonicoPdf({x_normalizada:(90+banda.x_inicio*180)/760,y_normalizada:0}).x;
      assert.ok(draw.mock.calls.some(c=>Math.abs(c.arguments[0]!.x!-x)<1e-8&&Math.abs(c.arguments[0]!.y!-y(hasta))<1e-8&&Math.abs(c.arguments[0]!.height!-(y(desde)-y(hasta)))<1e-8));
    }
  }
  assert.ok((await doc.save()).length>1000);
});
test('proporción aprobada: solapamiento y cambios de diámetro conservan contacto y margen de terreno',()=>{
  const p=crearPerfilLitologico(roca,240,[],tubos,[],rango(5,25),[rango(5,25)])!;
  const sello=p.sello_sanitario_constructivo!.geometria.segmentos;
  const prefiltro=p.prefiltro_constructivo[0].geometria.segmentos;
  assert.deepEqual(prefiltro.map(s=>rango(s.desde_m,s.hasta_m)),[rango(5,20),rango(20,25)]);
  for(const [i,s] of sello.entries()) {
    const g=prefiltro[i],t=p.tuberias[i].geometria;
    assert.equal(s.bandas[0].x_fin,t.x_inicio);
    assert.equal(s.bandas[1].x_inicio,t.x_fin);
    assert.equal(g.bandas[0].x_fin,s.bandas[0].x_inicio);
    assert.equal(g.bandas[1].x_inicio,s.bandas[1].x_fin);
    for(const [bandas,espesor] of [[s.bandas,ESPESOR_GRAFICO_SELLO],[g.bandas,ESPESOR_GRAFICO_PREFILTRO]] as const)
      for(const b of bandas) {
        assert.ok(b.x_inicio>0 && b.x_fin<1 && b.x_fin>b.x_inicio);
        assert.ok(Math.abs(b.x_fin-b.x_inicio-espesor)<1e-10);
      }
  }
  assert.ok(prefiltro[1].bandas[0].x_inicio>prefiltro[0].bandas[0].x_inicio);
  assert.equal(p.tramos[0].hasta_m,240);
  assert.equal(p.etiquetas.filter(e=>e.tipo==='prefiltro').length,1);
});

test('prefiltro no inventa filtro ni cañería en tramo abierto',()=>{
  const p=crearPerfilLitologico(roca,240,[],[{...tubos[0],hasta_m:240,sin_tuberia:true,material_tuberia:null}],[],null,[rango(13.5,15.5)])!;
  assert.equal(p.tuberias.length,0);assert.equal(p.contornos_tuberia.length,0);assert.equal(p.filtros.length,0);
  assert.ok(p.advertencias.some(a=>a.includes('sin filtros')));assert.equal(p.prefiltro_constructivo.length,1);
});
test('etiqueta decimal exacta y leyenda extensa con ambos elementos no excede márgenes',async t=>{
  const materiales=Array.from({length:30},(_,i)=>({desde_m:i*8,hasta_m:(i+1)*8,material:'Material '+i}));
  const p=crearPerfilLitologico(materiales,240,[],tubos,filtro,rango(0,10),[rango(13.125,15.875)])!;
  assert.equal(p.prefiltro_constructivo[0].texto,'Prefiltro de gravilla · 13.125-15.875 m');
  const textos=t.mock.method(PDFPage.prototype,'drawText');
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  dibujarPerfilLitologico(doc,p,font,bold);
  assert.ok(doc.getPageCount()>p.rangos.length);
  assert.equal(textos.mock.calls.filter(c=>c.arguments[0]==='Prefiltro').length,1);
  for(const c of textos.mock.calls){
    const text=c.arguments[0],o=c.arguments[1]!;
    assert.ok(o.x!+(o.font??font).widthOfTextAtSize(text,o.size!)<595.28);
    assert.ok(o.y!>=0&&o.y!<841.89);
  }
});
