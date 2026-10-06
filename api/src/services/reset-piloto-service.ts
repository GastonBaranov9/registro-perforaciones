import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export const CLAVES_PILOTO = [
  '2ed1c44f-c89a-4cef-8b3c-79079cafa52c','89bc0fa7-f13e-4e11-bc71-2faf5f185128','8f647f06-aa3d-4af4-9833-d585e814d1b5',
  '94660726-ae02-4879-8ee5-9bd66dc77140','a89574ff-94d3-471d-8ba5-cb8c7cbbd4cc','b733dd02-e2e9-4884-a786-f2a0bf081cdf',
  'c573063c-7098-4696-af76-fe9ae66f370e','e4642222-6ce0-4460-8929-5b19228a60f1','ea9f85e1-3ba6-46c5-b1ae-bf3278937a44',
].sort();
export const TABLAS_RESET = ['catalogo_litologia','clave_offline_cerrada','creacion_offline','creacion_historica','documento','epoca_datos','informe','intervalo_diametro_perforacion','intervalo_filtro','intervalo_litologico','nivel_aporte','numeracion_perforacion','numeracion_perforacion_configuracion','numero_perforacion_reservado','permiso','pozo','rol','rol_permiso','schema_migrations','sesion_nativa','sitio','ticket_ws_nativo','usuario','usuario_rol'].sort();
function exigir(ok: unknown, mensaje: string): asserts ok { if (!ok) throw new Error(`RESET_ABORTADO: ${mensaje}`); }
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function filas(c: PoolClient, sql: string) { return (await c.query(sql)).rows; }
async function sinOtrosClientes(c: PoolClient) {
  exigir(Number((await c.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n) === 0,
    'Hay otros clientes conectados. Se requiere mantenimiento con todos los escritores y réplicas de API detenidos.');
}

export interface ResetPilotoOpciones {
  database: string; user: string;
  // La CLI exige backup verificado y mantenimiento. El servicio también verifica
  // ausencia de otros clientes. Nunca ejecuta Docker, migra ni detiene servicios.
  mantenimiento: true;
  verificarMigraciones: (ledger: unknown[]) => Promise<void>;
  cuarentena: () => Promise<void>;
  restaurarFoto: () => Promise<void>;
  registrarPreparado: (datos: unknown) => Promise<void>;
}

export async function resetPiloto(pool: Pick<Pool, 'connect'>, opciones: ResetPilotoOpciones) {
  exigir(opciones.mantenimiento === true, 'Falta mantenimiento');
  const client = await pool.connect();
  let fotoMovida = false; let commitIntentado = false; let descartar = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    const destino = (await client.query('SELECT current_database() db,current_user AS usuario')).rows[0];
    exigir(destino.db === opciones.database && destino.usuario === opciones.user, 'Destino distinto del autorizado');
    await sinOtrosClientes(client);
    await client.query('SELECT pg_advisory_xact_lock(731024,1)');
    const tablas = (await filas(client, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
    exigir(igual(tablas, TABLAS_RESET), 'Tablas inesperadas o faltantes');
    await client.query(`LOCK TABLE ${TABLAS_RESET.map(t => 'public.' + t).join(',')} IN ACCESS EXCLUSIVE MODE`);
    const ledger = await filas(client, 'SELECT * FROM schema_migrations ORDER BY version');
    exigir(igual(ledger.map(r => r.version), Array.from({length:18},(_,i)=>String(i).padStart(3,'0'))), 'Se requieren exactamente migraciones 000..017');
    await opciones.verificarMigraciones(ledger);
    const usuarios = await filas(client, 'SELECT * FROM usuario ORDER BY id_usuario');
    exigir(igual(usuarios.map(u => Number(u.id_usuario)), [1,2,3,6,8]), 'Usuarios inesperados o faltantes');
    exigir(igual(usuarios.map(u => [u.nombre,u.activo,u.cuenta_acceso]), [['Gaston Baranov',true,true],['Ramiro',true,false],['Gaston Souza',true,true],['Luis Diaz',true,true],['Ricardo',true,true]]), 'Identidades o acceso diferentes');
    exigir(usuarios[0].email && usuarios[0].password, 'Administrador 1 sin credenciales');
    const roles = await filas(client, 'SELECT * FROM rol ORDER BY id_rol');
    const relaciones = await filas(client, 'SELECT * FROM usuario_rol ORDER BY id_usuario,id_rol');
    exigir(igual(roles.map(r=>[Number(r.id_rol),r.nombre]), [[1,'administracion'],[2,'perforador'],[3,'propietario']]), 'Roles inesperados');
    exigir(igual(relaciones.map(r=>[Number(r.id_usuario),Number(r.id_rol)]), [[1,1],[2,3],[3,2],[6,2],[8,3]]), 'Administrador o relaciones de rol inesperados');
    const catalogo = await filas(client, 'SELECT * FROM catalogo_litologia ORDER BY id_litologia');
    exigir(catalogo.length===30 && catalogo.every((r,i)=>Number(r.id_litologia)===i+1), 'Catálogo distinto de 30 identidades esperadas');
    const pozos = await filas(client, 'SELECT id_pozo,numero_perforacion,id_propietario,id_perforador,creado_por,id_sitio,foto_url,origen,propietario_provisional,propietario_provisional_original FROM pozo ORDER BY id_pozo');
    exigir(pozos.length===1 && igual(Object.values(pozos[0]), ['5',2580,'8','6','1','5','/usuarios/8/pozos/5/foto','normal',null,null]), 'Pozo piloto distinto del inventario');
    const sitios = await filas(client, 'SELECT id_sitio,departamento,localidad,padron FROM sitio ORDER BY id_sitio');
    exigir(igual(sitios,[{id_sitio:'5',departamento:'Salto',localidad:'Salto',padron:null}]), 'Sitios distintos del inventario');
    for (const [tabla,id,esperados] of [
      ['intervalo_litologico','id_intervalo_litologico',[44]],['intervalo_diametro_perforacion','id_intervalo_diametro_perforacion',[36]],
      ['intervalo_filtro','id_intervalo_filtro',[9]],['nivel_aporte','id_nivel_aporte',[22,23]],
    ] as const) {
      const actual = await filas(client, `SELECT ${id} id,id_pozo FROM ${tabla} ORDER BY ${id}`);
      exigir(igual(actual.map(r=>[Number(r.id),Number(r.id_pozo)]),esperados.map(n=>[n,5])), `Dependencias inesperadas en ${tabla}`);
    }
    for (const tabla of ['documento','informe','creacion_offline','creacion_historica','numeracion_perforacion_configuracion','permiso','rol_permiso'])
      exigir((await filas(client, `SELECT 1 FROM ${tabla} LIMIT 1`)).length===0, `${tabla} debe estar vacía`);
    const reservas = await filas(client, 'SELECT numero_perforacion,id_pozo_original FROM numero_perforacion_reservado ORDER BY numero_perforacion');
    exigir(igual(reservas,[{numero_perforacion:2580,id_pozo_original:'5'},{numero_perforacion:3001,id_pozo_original:'4'}]), 'Reservas distintas del inventario');
    const num = await filas(client, 'SELECT singleton,proximo,mayor_asignado FROM numeracion_perforacion');
    exigir(igual(num,[{singleton:true,proximo:null,mayor_asignado:3001}]), 'Numeración distinta del inventario');
    const epocas = await filas(client, 'SELECT epoca FROM epoca_datos WHERE singleton=TRUE FOR UPDATE');
    exigir(epocas.length===1, 'Época ausente');
    const anterior = epocas[0].epoca; const nueva = randomUUID();
    const cerradas = await filas(client, 'SELECT actor,clave,epoca FROM clave_offline_cerrada ORDER BY clave');
    exigir(igual(cerradas.map(r=>r.clave),CLAVES_PILOTO) && cerradas.every(r=>Number(r.actor)===6 && r.epoca===anterior), 'Claves cerradas distintas del inventario');
    const secuencias = await filas(client, "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
    // Registrar exclusivamente metadata segura: nunca usuarios completos/passwords.
    await opciones.registrarPreparado({ database: destino.db, epoca_anterior: anterior, epoca_nueva: nueva, usuarios_conservados:[1,2,3,6], proximo:3282, mayor_asignado:0 });
    await opciones.cuarentena(); fotoMovida = true;
    await client.query('DELETE FROM intervalo_litologico WHERE id_intervalo_litologico=44');
    await client.query('DELETE FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion=36');
    await client.query('DELETE FROM intervalo_filtro WHERE id_intervalo_filtro=9');
    await client.query('DELETE FROM nivel_aporte WHERE id_nivel_aporte IN (22,23)');
    await client.query('DELETE FROM pozo WHERE id_pozo=5');
    await client.query('DELETE FROM sitio WHERE id_sitio=5');
    await client.query('DELETE FROM numero_perforacion_reservado WHERE numero_perforacion IN (2580,3001)');
    await client.query('DELETE FROM clave_offline_cerrada WHERE actor=6 AND clave=ANY($1::uuid[])',[CLAVES_PILOTO]);
    await client.query('DELETE FROM ticket_ws_nativo');
    await client.query('DELETE FROM sesion_nativa');
    await client.query('DELETE FROM usuario_rol WHERE id_usuario=8');
    await client.query('DELETE FROM usuario WHERE id_usuario=8');
    await client.query('UPDATE usuario SET version_sesion=version_sesion+1 WHERE id_usuario IN (1,2,3,6)');
    await client.query('UPDATE epoca_datos SET epoca=$1,cambiada_en=clock_timestamp() WHERE singleton=TRUE',[nueva]);
    await client.query('UPDATE numeracion_perforacion SET proximo=3282,mayor_asignado=0 WHERE singleton=TRUE');
    // El historial usa su BIGSERIAL habitual; no se reinicia ninguna secuencia.
    await client.query('INSERT INTO numeracion_perforacion_configuracion(anterior,proximo,cambiado_por) VALUES(NULL,3282,1)');
    for (const tabla of ['pozo','sitio','numero_perforacion_reservado','intervalo_litologico','intervalo_diametro_perforacion','intervalo_filtro','nivel_aporte','documento','informe','creacion_offline','clave_offline_cerrada','creacion_historica','sesion_nativa','ticket_ws_nativo'])
      exigir((await filas(client,`SELECT 1 FROM ${tabla} LIMIT 1`)).length===0, `Postcondición ${tabla} vacía`);
    const conservados = usuarios.filter(u=>Number(u.id_usuario)!==8).map(u=>({...u,version_sesion:u.version_sesion+1}));
    exigir(igual(await filas(client,'SELECT * FROM usuario ORDER BY id_usuario'),conservados),'Usuarios o versiones alterados incorrectamente');
    exigir(igual(await filas(client,'SELECT * FROM usuario_rol ORDER BY id_usuario,id_rol'),relaciones.filter(r=>Number(r.id_usuario)!==8)),'Roles conservados diferentes');
    exigir(igual(await filas(client,'SELECT * FROM rol ORDER BY id_rol'),roles),'Roles modificados');
    exigir(igual(await filas(client,'SELECT * FROM catalogo_litologia ORDER BY id_litologia'),catalogo),'Catálogo modificado');
    exigir(igual(await filas(client,'SELECT * FROM schema_migrations ORDER BY version'),ledger),'Ledger modificado');
    const sinHistorial = (rows: Record<string,unknown>[]) => rows.filter(r=>r.sequencename!=='numeracion_perforacion_configuracion_id_seq');
    exigir(igual(sinHistorial(await filas(client,"SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")),sinHistorial(secuencias)),'Secuencias de negocio modificadas');
    exigir(igual(await filas(client,'SELECT proximo,mayor_asignado FROM numeracion_perforacion'),[{proximo:'3282',mayor_asignado:0}]),'Numeración final incorrecta');
    exigir((await filas(client,'SELECT epoca FROM epoca_datos'))[0].epoca===nueva,'Época final incorrecta');
    exigir(igual(await filas(client,'SELECT anterior,proximo,cambiado_por FROM numeracion_perforacion_configuracion'),[{anterior:null,proximo:'3282',cambiado_por:'1'}]),'Historial incorrecto');
    await sinOtrosClientes(client);
    commitIntentado = true; await client.query('COMMIT');
    return { epoca: nueva, proximo:3282, mayor_asignado:0 };
  } catch (error) {
    let rollbackSeguro = false;
    try { await client.query('ROLLBACK'); rollbackSeguro = true; } catch { descartar = true; /* mantener cuarentena */ }
    if (fotoMovida && rollbackSeguro && !commitIntentado) await opciones.restaurarFoto();
    // Una respuesta COMMIT perdida no prueba rollback. No devolver foto piloto
    // al almacenamiento activo hasta resolver mediante el journal y PostgreSQL.
    throw error;
  } finally { client.release(descartar); }
}
