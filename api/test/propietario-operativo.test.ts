import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { actualizarPropietarioOperativo, crearPropietarioOperativo, listarCandidatosPozo } from "../src/services/candidatos-pozo-service.ts";
import pozoRoutes from "../src/routes/pozos.ts";
import * as err from "../src/models/errors.ts";
import { sitioEsGestionablePorPerforador } from "../src/services/autorizacion-recursos.ts";

test("alta operativa asigna exclusivamente propietario y no entrega credenciales", async () => {
  const consultas:Array<{sql:string;params?:unknown[]}>=[];
  const client={async query(sql:string,params?:unknown[]){consultas.push({sql,params});
    if(sql.includes("SELECT id_rol"))return{rows:[{id_rol:7}]};
    if(sql.includes("INSERT INTO usuario "))return{rows:[{id_usuario:"91",nombre:"Persona nueva",email:null}]};
    return{rows:[]};},release(){}};
  const creado=await crearPropietarioOperativo({nombre:" Persona nueva "},{async connect(){return client;}} as never);
  assert.deepEqual(creado,{id_usuario:91,nombre:"Persona nueva",roles:["propietario"]});
  const asignacion=consultas.find((x)=>x.sql.includes("INSERT INTO usuario_rol"));
  assert.deepEqual(asignacion?.params,["91",7]);
  const insercion=consultas.find((x)=>x.sql.includes("INSERT INTO usuario "));
  assert.match(insercion?.sql ?? "", /NULL,\$1,NULL,TRUE,FALSE/);
  assert.deepEqual(insercion?.params,["Persona nueva",null,null,null,null,null,null,null]);
  assert.ok(consultas.every((x)=>!x.sql.includes("administracion")&&!x.sql.includes("perforador")));
});

test("alta operativa normaliza todos los datos de contacto sin crear una cuenta", async () => {
  const consultas:Array<{sql:string;params?:unknown[]}>=[];
  const client={async query(sql:string,params?:unknown[]){consultas.push({sql,params});
    if(sql.includes("SELECT id_rol"))return{rows:[{id_rol:7}]};
    if(sql.includes("INSERT INTO usuario "))return{rows:[{id_usuario:"92",nombre:"Ana Pérez",documento_rut:"1.234.567-8",telefono:"+598 99 123 456",email:"ana@example.test",direccion:"Ruta 3",localidad:"Young",departamento:"Río Negro",observaciones:"Contacto operativo"}]};
    return{rows:[]};},release(){}};
  const creado=await crearPropietarioOperativo({nombre:" Ana Pérez ",documento_rut:" 1.234.567-8 ",telefono:" +598 99 123 456 ",email:" ana@example.test ",direccion:" Ruta 3 ",localidad:" Young ",departamento:"Río Negro",observaciones:" Contacto operativo "},{async connect(){return client;}} as never);
  assert.equal(creado.documento_rut,"1.234.567-8");assert.equal(creado.email,"ana@example.test");
  const insercion=consultas.find((x)=>x.sql.includes("INSERT INTO usuario "))!;
  assert.match(insercion.sql,/cuenta_acceso/);assert.match(insercion.sql,/NULL,\$1,NULL,TRUE,FALSE/);
  assert.deepEqual(insercion.params,["Ana Pérez","1.234.567-8","+598 99 123 456","ana@example.test","Ruta 3","Young","Río Negro","Contacto operativo"]);
});

test("rechaza nombre email y departamento inválidos", async () => {
  const sinConexion={async connect(){throw new Error("no debe conectar");}} as never;
  await assert.rejects(()=>crearPropietarioOperativo({nombre:"   "},sinConexion),/nombre y apellido/i);
  await assert.rejects(()=>crearPropietarioOperativo({nombre:"Persona",email:"incorrecto"},sinConexion),/email/i);
  await assert.rejects(()=>crearPropietarioOperativo({nombre:"Persona",departamento:"Oriental" as "Artigas"},sinConexion),/catálogo/i);
});

test("blanks opcionales se guardan como NULL", async () => {
  const client={async query(sql:string,params?:unknown[]){
    if(sql.includes("SELECT id_rol"))return{rows:[{id_rol:7}]};
    if(sql.includes("INSERT INTO usuario ")){assert.deepEqual(params?.slice(1),[null,null,null,null,null,null,null]);return{rows:[{id_usuario:93,nombre:"Solo nombre"}]};}
    return{rows:[]};},release(){}};
  await crearPropietarioOperativo({nombre:"Solo nombre",documento_rut:" ",telefono:"",email:"  ",direccion:"",localidad:" ",departamento:"",observaciones:" "},{async connect(){return client;}} as never);
});

test("edición limpia opcionales y preserva campos omitidos", async () => {
  let params:unknown[]=[];
  const db={async query(_sql:string,p?:unknown[]){params=p??[];return{rows:[{id_usuario:9,nombre:"Nombre previo",documento_rut:null,telefono:"099",email:"contacto@example.test",direccion:null,localidad:null,departamento:null,observaciones:null}]};}};
  const actualizado=await actualizarPropietarioOperativo(9,{documento_rut:"   "},db as never);
  assert.equal(actualizado?.documento_rut,null);assert.equal(actualizado?.telefono,"099");
  assert.equal(params[1],false); // nombre omitido
  assert.equal(params[3],true);assert.equal(params[4],null); // documento limpiado
  assert.equal(params[5],false); // teléfono omitido
});

test("búsqueda remota incluye nombre documento teléfono y email, admite un carácter y limita", async () => {
  let sql="";let params:unknown[]=[];
  const db={async query(q:string,p?:unknown[]){sql=q;params=p??[];return{rows:[{id_usuario:5,nombre:"Juan",documento_rut:"1.2",roles:["propietario"]}]};}};
  const resultado=await listarCandidatosPozo(3,true,db as never,{propietario:"1",limite:20});
  assert.equal(resultado.propietarios[0].documento_rut,"1.2");assert.equal(params[3],"1");assert.equal(params[4],20);
  assert.match(sql,/documento_rut/);assert.match(sql,/telefono/);assert.match(sql,/propietario_email/);
});

test("un usuario sin rol autorizado recibe 403 antes de crear propietario", async () => {
  const app=Fastify();
  const permitir=async()=>{};const denegar=async()=>{throw new err.T05SinPermiso();};
  app.decorate("authenticate",permitir);app.decorate("userIsAdminOrPerforador",denegar);
  app.decorate("pozoIsFromUser",permitir);app.decorate("userIsPropietarioOrPerforadorOrAdmin",permitir);
  await app.register(pozoRoutes);
  const respuesta=await app.inject({method:"POST",url:"/pozos/propietarios",payload:{nombre:"No autorizado",email:"no@example.test",password:"secreto",roles:[]}});
  assert.equal(respuesta.statusCode,403);await app.close();
});

test("un perforador solo gestiona sitios vinculados a sus pozos",async()=>{
  const consultas:Array<{sql:string;params?:unknown[]}>=[];
  const relacionado={async query(sql:string,params?:unknown[]){consultas.push({sql,params});return{rows:[{"?column?":1}]};}};
  const ajeno={async query(){return{rows:[]};}};
  assert.equal(await sitioEsGestionablePorPerforador(12,8,relacionado as never),true);
  assert.equal(await sitioEsGestionablePorPerforador(12,9,ajeno as never),false);
  assert.deepEqual(consultas[0].params,[12,8]);
  assert.match(consultas[0].sql,/id_sitio=\$1 AND p\.id_perforador=\$2/);
});
