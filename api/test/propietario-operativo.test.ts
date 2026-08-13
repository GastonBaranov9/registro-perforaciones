import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { crearPropietarioOperativo } from "../src/services/candidatos-pozo-service.ts";
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
  assert.deepEqual(creado,{id_usuario:91,nombre:"Persona nueva",email:undefined,roles:["propietario"]});
  const asignacion=consultas.find((x)=>x.sql.includes("INSERT INTO usuario_rol"));
  assert.deepEqual(asignacion?.params,["91",7]);
  const insercion=consultas.find((x)=>x.sql.includes("INSERT INTO usuario "));
  assert.match(insercion?.sql ?? "", /NULL,\$1,NULL,TRUE,FALSE/);
  assert.equal(insercion?.params?.length, 1);
  assert.ok(consultas.every((x)=>!x.sql.includes("administracion")&&!x.sql.includes("perforador")));
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
