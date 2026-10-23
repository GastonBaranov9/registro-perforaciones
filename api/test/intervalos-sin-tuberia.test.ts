import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PDFDocument, PDFPage, StandardFonts } from 'pdf-lib';
import { IntervaloDiametroPerforacionBody, PozoCompletoBody } from '../src/models/schemas.ts';
import { validarDatosTecnicosPozo, huellaOffline } from '../src/services/pozo-completo-service.ts';
import { createIntervaloDiametro, updateIntervaloDiametro } from '../src/services/intervalo-diametro-services.ts';
import { crearFiltro, actualizarFiltro } from '../src/services/intervalos-filtro-service.ts';
import { crearPerfilLitologico, dibujarPerfilLitologico } from '../src/pdf/perfil-litologico.ts';
import { casosConstructivos } from './perfil-constructivo-casos.ts';

const abierto = {desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true};
const datos = () => ({profundidad_final_m:50,intervalos_litologicos:[],intervalos_diametro:[{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:'PVC' as const},abierto],intervalos_filtro:[],niveles_aporte:[]});

test('contrato opcional conserva solicitudes antiguas y su huella; acepta el estado explícito', async () => {
  const app = Fastify({ajv:{customOptions:{coerceTypes:false}}});
  app.post('/',{schema:{body:IntervaloDiametroPerforacionBody}},async req=>req.body);
  app.post('/completo',{schema:{body:PozoCompletoBody}},async req=>req.body);
  try {
    for (const dato of [datos().intervalos_diametro[0],abierto,{...abierto,sin_tuberia:false,material_tuberia:'PVC'}]) {
      const res=await app.inject({method:'POST',url:'/',payload:dato});
      assert.equal(res.statusCode,200); assert.deepEqual(res.json(),dato);
      assert.equal(huellaOffline(res.json()),huellaOffline(dato));
    }
    const legacy={pozo:{id_propietario:null,id_perforador:3,propietario_provisional:'Persona'},
      sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},
      intervalos_litologicos:[],intervalos_diametro:[datos().intervalos_diametro[0]],intervalos_filtro:[],niveles_aporte:[]};
    const antes=huellaOffline(legacy);
    const res=await app.inject({method:'POST',url:'/completo',payload:legacy});
    assert.equal(res.statusCode,200);
    assert.equal(huellaOffline(res.json()),antes);
    assert.equal(Object.hasOwn(res.json().intervalos_diametro[0],'sin_tuberia'),false);
    assert.equal((await app.inject({method:'POST',url:'/',payload:{...abierto,sin_tuberia:'true'}})).statusCode,400);
  } finally { await app.close(); }
});

test('valida material nulo exclusivamente para sin cañería y prohíbe superposición con filtros', () => {
  assert.deepEqual(validarDatosTecnicosPozo(datos()),[]);
  assert.ok(validarDatosTecnicosPozo({...datos(),intervalos_diametro:[{...abierto,material_tuberia:'PVC'}]}).some(e=>e.includes('no admite')));
  assert.ok(validarDatosTecnicosPozo({...datos(),intervalos_diametro:[{...abierto,sin_tuberia:false}]}).some(e=>e.includes('material inválido')));
  const filtro={desde_m:19,hasta_m:21,diametro_pulg:8,material_tuberia:'PVC' as const,ranura_mm:0.5 as const};
  assert.ok(validarDatosTecnicosPozo({...datos(),intervalos_filtro:[filtro]}).some(e=>e.includes('no puede solaparse')));
  assert.deepEqual(validarDatosTecnicosPozo({...datos(),intervalos_filtro:[{...filtro,hasta_m:20}]}),[]);
});

test('CRUD de diámetro envía el booleano y el material nulo sin perder rango ni diámetro', async () => {
  const db={query:async(sql:string,p:unknown[]=[])=>{
    if(sql.includes('FROM intervalo_filtro'))return {rows:[]};
    if(sql.includes('SELECT profundidad'))return {rows:[{profundidad_final_m:50}]};
    if(sql.includes('SELECT id_intervalo') && (sql.includes('<>') || sql.includes('LIMIT')))return {rows:[]};
    if(sql.includes('INSERT INTO') || sql.includes('UPDATE intervalo')) {
      assert.equal(p.at(-1),true); assert.equal(p.at(-2),null);
      return {rows:[{id_intervalo_diametro_perforacion:1,id_pozo:1,...abierto}]};
    }
    return {rows:[{id_intervalo_diametro_perforacion:1}]};
  }};
  assert.equal((await createIntervaloDiametro(1,abierto,db)).sin_tuberia,true);
  assert.equal((await updateIntervaloDiametro(1,1,abierto,db))?.sin_tuberia,true);
});

test('CRUD impide contradicción en ambas direcciones, incluyendo edición de filtros', async () => {
  const db={query:async()=>({rows:[{id_intervalo_diametro_perforacion:1,id_intervalo_filtro:1}]})};
  const filtro={desde_m:21,hasta_m:25,diametro_pulg:8,material_tuberia:'PVC' as const,ranura_mm:0.5 as const};
  for(const action of [
    ()=>createIntervaloDiametro(1,abierto,db),()=>updateIntervaloDiametro(1,1,abierto,db),
    ()=>crearFiltro(1,filtro,db),()=>actualizarFiltro(1,1,filtro,db),
  ]) await assert.rejects(action,/no puede solaparse/);
});

test('A/B: sello ancho, contacto con caño, terreno completo y profundidad exacta', () => {
  const {A,B}=casosConstructivos();
  for(const p of [A,B]) {
    assert.equal(p.tramos.length,1);assert.equal(p.tramos[0].hasta_m,20);
    const s=p.sello_sanitario_constructivo!;
    for(const r of s.geometria.segmentos) {
      assert.equal(r.desde_m,s.desde_m);assert.equal(r.hasta_m,s.hasta_m);
      assert.ok(r.bandas.every(b=>b.x_fin-b.x_inicio>=.23));
      assert.equal(r.bandas[0].x_fin,p.tuberias[0].geometria.x_inicio);
      assert.equal(r.bandas[1].x_inicio,p.tuberias[0].geometria.x_fin);
    }
    assert.equal(p.sobresaliente?.alto_logico,18);
  }
  assert.equal(B.sello_sanitario_constructivo!.geometria.segmentos[0].desde_m,5);
});

test('C/D/F: abierto sin contornos de tubo; null legado conserva cañería y diámetro variable', () => {
  const {C,D,F,superficieAbierta}=casosConstructivos();
  assert.deepEqual(C.tuberias.map(t=>[t.desde_m,t.hasta_m]),[[0,20]]);
  assert.deepEqual(C.perforaciones_abiertas.map(t=>[t.desde_m,t.hasta_m,t.diametro_pulg]),[[20,50,8]]);
  assert.ok(C.contornos_tuberia.every(t=>t.hasta_m<=20));
  assert.match(C.etiquetas.find(e=>e.tipo==='perforacion_abierta')!.texto,/sin cañería.*8 pulg.*20-50/);
  assert.equal(D.perforaciones_abiertas.length,0);assert.equal(D.tuberias[0].material_texto,'No especificado');
  assert.equal(superficieAbierta.sobresaliente,null);assert.deepEqual(superficieAbierta.contornos_tuberia,[]);
  const segmentos=F.sello_sanitario_constructivo!.geometria.segmentos;
  assert.deepEqual(segmentos.map(s=>[s.desde_m,s.hasta_m]),[[0,5],[5,12]]);
  assert.ok(segmentos[1].bandas[0].x_fin>segmentos[0].bandas[0].x_fin);
  assert.ok(F.contornos_tuberia.some(t=>t.desde_m===40));
  assert.ok(F.contornos_tuberia.every(t=>t.hasta_m<=20||t.desde_m>=40));
});

test('superficie: no inventa caño sin datos; reconoce componentes instalados que llegan a cero',()=>{
  assert.equal(crearPerfilLitologico([],20)!.sobresaliente,null);
  const filtro={desde_m:0,hasta_m:5,diametro_pulg:8,material_tuberia:'Acero' as const};
  assert.equal(crearPerfilLitologico([],20,[],[],[filtro])!.sobresaliente?.material_tuberia,'Acero');
  assert.equal(crearPerfilLitologico([],20,[],[{...filtro,desde_m:1}],[])!.sobresaliente,null);
});

test('PDF: tramo abierto sin tubo, sobresaliente sólo en superficie y sello proyectado por segmentos', async context => {
  const rects:Array<{page:PDFPage;args:any}>=[],textos:string[]=[];
  context.mock.method(PDFPage.prototype,'drawRectangle',function(this:PDFPage,args:any){rects.push({page:this,args});});
  context.mock.method(PDFPage.prototype,'drawText',(text:string)=>{textos.push(text);});
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const p=casosConstructivos().multipagina;
  const pages=dibujarPerfilLitologico(doc,p,font,bold);
  assert.equal(textos.filter(t=>t.startsWith('Nivel de terreno')).length,1);
  assert.match(textos.find(t=>t.startsWith('Perforación sin cañería'))!,/120-200 m$/);
  assert.equal(rects.filter(r=>Math.abs(r.args.height-18/820*750)<1e-6).length,1);
  assert.equal(rects.filter(r=>r.args.borderDashArray && r.args.borderWidth===1).length,1); // 120–200, segunda página
  assert.equal(rects.find(r=>r.args.borderDashArray)!.page,pages[1]);
  const abiertas=rects.filter(r=>r.args.borderDashArray);
  for(const r of abiertas) assert.ok(!rects.some(t=>t.page===r.page && t.args.opacity===.82 && t.args.y<r.args.y+r.args.height && t.args.y+t.args.height>r.args.y));
});
