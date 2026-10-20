import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { ejecutarMigraciones, leerMigraciones, DIRECTORIO_MIGRACIONES } from '../src/db/migrator.ts';
import type { PozoCompletoBody, PozoCompletoUpdateBody } from '../src/models/schemas.ts';

test('020 y servicios de sello sanitario en un clúster PostgreSQL desechable', async context => {
  const bin = process.env.RSP_SELLO_PG_BIN ?? 'C:/Program Files/PostgreSQL/17/bin';
  const root = await mkdtemp(path.join(tmpdir(), 'rsp-sello-'));
  const data = path.join(root, 'data');
  const password = randomBytes(24).toString('hex');
  const passwordFile = path.join(root, 'password');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && key !== 'NODE_TEST_CONTEXT'));
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const pg = (command: string, args: string[]) => execFileSync(path.join(bin, command + (process.platform === 'win32' ? '.exe' : '')), args,
    { env, encoding: 'utf8', windowsHide: true, timeout: 60_000, stdio: command === 'pg_ctl' ? 'ignore' : 'pipe' });
  const config = { host: '127.0.0.1', port, user: 'postgres', password, ssl: false as const, options: '' };
  const pools: Pool[] = [];
  let started = false;
  let cerrarAplicacion: (() => Promise<void>) | undefined;
  let cerrarPoolAplicacion: (() => Promise<void>) | undefined;
  try {
    await writeFile(passwordFile, password);
    pg('initdb', ['-D', data, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C']);
    pg('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
    started = true;
    const control = new Pool({ ...config, database: 'postgres' });
    pools.push(control);
    assert.equal(path.resolve((await control.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(data).toLowerCase());
    const previas = path.join(root, 'previas');
    await mkdir(previas);
    for (const migracion of (await leerMigraciones()).filter(item => item.version < '020'))
      await copyFile(path.join(DIRECTORIO_MIGRACIONES, migracion.archivo), path.join(previas, migracion.archivo));
    await control.query('CREATE DATABASE sello_template');
    const template = new Pool({ ...config, database: 'sello_template' });
    await ejecutarMigraciones(template, { directorio: previas });
    await template.query(`INSERT INTO usuario(id_usuario,nombre,email,password) VALUES
      (1,'Admin','admin@sello.test','prueba'),(2,'Propietario','prop@sello.test','prueba'),(3,'Perforador','perf@sello.test','prueba');
      INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='propietario';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO sitio(departamento) VALUES('Salto');
      UPDATE numeracion_perforacion SET proximo=3282;`);
    await template.end();
    let numeroDb = 0;
    const base = async () => {
      const nombre = `sello_caso_${++numeroDb}`;
      await control.query(`CREATE DATABASE ${nombre} TEMPLATE sello_template`);
      const pool = new Pool({ ...config, database: nombre });
      pools.push(pool);
      return { pool, nombre };
    };
    const pozoPrueba = `INSERT INTO pozo(id_propietario,id_perforador,id_sitio,profundidad_final_m,sello_sanitario)
      VALUES(2,3,1,30,true)`;
    const candidato = `INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia)
      SELECT 1,1.250000000000000000001,9.875000000000000000009,'Texto fuente conservado',id_litologia
      FROM catalogo_litologia WHERE codigo='sello_sanitario'`;
    await context.test('migra decimales exactos, preserva terreno superpuesto y booleano, retira catálogo y admite rerun', async () => {
      const { pool } = await base();
      await pool.query(pozoPrueba);
      await pool.query("INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES(1,0,30,'Terreno real',1)");
      const reales = (await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows;
      await pool.query(candidato);
      assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas, ['020_sello_sanitario_constructivo.sql']);
      assert.deepEqual((await pool.query('SELECT * FROM sello_sanitario_pozo')).rows, [{ id_pozo: '1', desde_m: '1.250000000000000000001', hasta_m: '9.875000000000000000009' }]);
      assert.deepEqual((await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows, reales);
      assert.deepEqual((await pool.query("SELECT activo,es_inicial FROM catalogo_litologia WHERE codigo='sello_sanitario'")).rows, [{ activo: false, es_inicial: false }]);
      assert.equal((await pool.query('SELECT sello_sanitario FROM pozo')).rows[0].sello_sanitario, true);
      assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas, []);
      await assert.rejects(pool.query("UPDATE catalogo_litologia SET activo=true WHERE codigo='sello_sanitario'"), { code: '23514' });
      await pool.query('DELETE FROM pozo WHERE id_pozo=1');
      assert.equal((await pool.query('SELECT count(*) FROM sello_sanitario_pozo')).rows[0].count, '0');
    });
    await context.test('ningún candidato y textos exactos/parecidos sin código canónico no generan sellos', async () => {
      const { pool } = await base();
      await pool.query(pozoPrueba);
      await pool.query(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden)
        VALUES('sello_parecido','Sello sanitario parecido','otro','#999999','concrete',31);
        INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia,litologia_provisional)
        SELECT 1,0,5,'Sello sanitario',id_litologia,NULL FROM catalogo_litologia WHERE codigo='sello_parecido';
        INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,litologia_provisional)
        VALUES(1,5,10,'Sello sanitario','Sello sanitario'),(1,10,15,'Sello sanitario',NULL);`);
      const antes = (await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows;
      await ejecutarMigraciones(pool);
      assert.equal((await pool.query('SELECT count(*) FROM sello_sanitario_pozo')).rows[0].count, '0');
      assert.deepEqual((await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows, antes);
    });
    for (const escenario of ['duplicado', 'negativo', 'no_finito', 'exceso', 'nombre_inesperado', 'fallo_final'] as const) {
      await context.test(`020 aborta y revierte todo ante ${escenario}`, async () => {
        const { pool } = await base();
        await pool.query(pozoPrueba);
        await pool.query(candidato);
        if (escenario === 'duplicado') await pool.query(candidato);
        if (escenario === 'negativo') await pool.query('UPDATE intervalo_litologico SET desde_m=-1');
        if (escenario === 'no_finito') await pool.query("UPDATE intervalo_litologico SET hasta_m='Infinity'::numeric");
        if (escenario === 'exceso') await pool.query('UPDATE intervalo_litologico SET hasta_m=31');
        if (escenario === 'nombre_inesperado') await pool.query("UPDATE catalogo_litologia SET nombre='Nombre administrativo' WHERE codigo='sello_sanitario'");
        if (escenario === 'fallo_final') await pool.query(`CREATE FUNCTION rechazar_retiro_sello() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'fallo final controlado'; END $$;
          CREATE TRIGGER rechazar_retiro_sello BEFORE UPDATE ON catalogo_litologia
          FOR EACH ROW EXECUTE FUNCTION rechazar_retiro_sello()`);
        const antes = (await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows;
        const catalogo = (await pool.query('SELECT * FROM catalogo_litologia ORDER BY 1')).rows;
        const ledger = (await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
        await assert.rejects(ejecutarMigraciones(pool), /Falló la migración 020/);
        assert.equal((await pool.query("SELECT to_regclass('public.sello_sanitario_pozo') AS tabla")).rows[0].tabla, null);
        assert.deepEqual((await pool.query('SELECT * FROM intervalo_litologico ORDER BY 1')).rows, antes);
        assert.deepEqual((await pool.query('SELECT * FROM catalogo_litologia ORDER BY 1')).rows, catalogo);
        assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows, ledger);
      });
    }
    const { pool, nombre } = await base();
    await ejecutarMigraciones(pool);
    Object.assign(process.env, { NODE_ENV: 'test', PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres',
      PGPASSWORD: password, PGDATABASE: nombre, FOTOS_DIR: path.join(root, 'fotos'), FASTIFY_SECRET: 'sello-test-local-secret' });
    const { myPool } = await import('../src/db/pool.ts');
    cerrarPoolAplicacion = () => myPool.end();
    const { crearPozoCompleto, actualizarPozoCompleto } = await import('../src/services/pozo-completo-service.ts');
    const { crearHistorico, editarHistorico } = await import('../src/services/historicos-service.ts');
    const { getPozoById, updatePozo } = await import('../src/services/pozos-services.ts');
    const { getReportePozo } = await import('../src/services/generar-informe-consultas.ts');
    const { obtenerSelloSanitario } = await import('../src/services/sello-sanitario-service.ts');
    const { createIntervaloLitologico, updateIntervaloLitologico } = await import('../src/services/intervalos-litologicos-services.ts');
    const { cambiarEstadoLitologia, listarLitologias } = await import('../src/services/litologias-services.ts');
    const { contextoEscritura } = await import('../src/services/escritura-sesion.ts');
    const epoca = (await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    const sello = { desde_m: 1.25, hasta_m: 9.875 };
    const cuerpo = (): PozoCompletoBody => ({ pozo: { id_propietario: 2, id_perforador: 3, profundidad_final_m: 30 },
      sitio_nuevo: { departamento: 'Salto', latitud: '-31', longitud: '-57' },
      intervalos_litologicos: [{ desde_m: 0, hasta_m: 30, material: 'Basalto marrón', id_litologia: 1 }],
      intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], sello_sanitario_constructivo: sello });
    const fotos = path.join(root, 'fotos');
    const leer = (id: number) => obtenerSelloSanitario(pool, id);
    const snapshot = async () => (await pool.query(`SELECT
      (SELECT json_agg(p ORDER BY id_pozo) FROM pozo p) AS pozos,
      (SELECT json_agg(s ORDER BY id_sitio) FROM sitio s) AS sitios,
      (SELECT json_agg(i ORDER BY id_intervalo_litologico) FROM intervalo_litologico i) AS litologias,
      (SELECT json_agg(ss ORDER BY id_pozo) FROM sello_sanitario_pozo ss) AS sellos,
      (SELECT json_agg(n ORDER BY numero_perforacion) FROM numero_perforacion_reservado n) AS reservas,
      (SELECT row_to_json(c) FROM numeracion_perforacion c) AS contador`)).rows;
    let normal: Awaited<ReturnType<typeof crearPozoCompleto>>;
    let historico: Awaited<ReturnType<typeof crearHistorico>>;
    await context.test('alta normal e histórica: sello decimal no inicial y terreno real coexistentes', async () => {
      normal = await crearPozoCompleto(3, cuerpo(), fotos, pool);
      historico = await crearHistorico(1, { numero_perforacion: 2100, profundidad_final_m: 30,
        sello_sanitario_constructivo: sello, intervalos_litologicos: cuerpo().intervalos_litologicos }, randomUUID(), epoca, pool);
      for (const id of [normal.pozo.id_pozo, historico.id_pozo]) {
        assert.deepEqual(await leer(id), sello);
        assert.deepEqual((await pool.query('SELECT desde_m,hasta_m FROM intervalo_litologico WHERE id_pozo=$1', [id])).rows, [{ desde_m: '0', hasta_m: '30' }]);
      }
      assert.deepEqual(normal.sello_sanitario_constructivo, sello);
      assert.deepEqual(historico.sello_sanitario_constructivo, sello);
    });
    await context.test('creación normal e histórica ausente/null no inventa sello ni usa booleano', async () => {
      for (const valor of [undefined, null]) {
        const body = cuerpo(); delete body.sello_sanitario_constructivo;
        if (valor === null) body.sello_sanitario_constructivo = null;
        const creado = await crearPozoCompleto(3, body, fotos, pool);
        const historica = await crearHistorico(1, { numero_perforacion: valor === null ? 2101 : 2102,
          ...(valor === null ? { sello_sanitario_constructivo: null } : {}) }, randomUUID(), epoca, pool);
        for (const id of [creado.pozo.id_pozo, historica.id_pozo]) {
          await pool.query('UPDATE pozo SET sello_sanitario=true WHERE id_pozo=$1', [id]);
          assert.equal(await leer(id), null);
          assert.equal((await getPozoById(id))?.sello_sanitario_constructivo, null);
        }
      }
    });
    const edicion = (selloNuevo?: typeof sello | null): PozoCompletoUpdateBody => ({
      pozo: { ...cuerpo().pozo, id_sitio: normal.sitio.id_sitio }, foto_accion: 'conservar',
      intervalos_litologicos: normal.intervalos_litologicos, intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
      ...(selloNuevo === undefined ? {} : { sello_sanitario_constructivo: selloNuevo }),
    });
    await context.test('edición normal e histórica: omisión conserva exactamente, objeto actualiza/crea y null elimina', async () => {
      await pool.query("UPDATE sello_sanitario_pozo SET desde_m='1.250000000000000000001',hasta_m='9.875000000000000000009' WHERE id_pozo=ANY($1::bigint[])", [[normal.pozo.id_pozo, historico.id_pozo]]);
      const original = (await pool.query('SELECT * FROM sello_sanitario_pozo ORDER BY id_pozo')).rows;
      normal = await actualizarPozoCompleto(normal.pozo.id_pozo, edicion(), fotos, pool);
      await editarHistorico(1, historico.id_pozo, { empresa: 'Conserva sello' }, pool);
      assert.deepEqual((await pool.query('SELECT * FROM sello_sanitario_pozo ORDER BY id_pozo')).rows, original);
      for (const valor of [{ desde_m: 2.5, hasta_m: 12.75 }, null, { desde_m: 0, hasta_m: 10 }]) {
        normal = await actualizarPozoCompleto(normal.pozo.id_pozo, edicion(valor), fotos, pool);
        await editarHistorico(1, historico.id_pozo, { sello_sanitario_constructivo: valor }, pool);
        assert.deepEqual(await leer(normal.pozo.id_pozo), valor);
        assert.deepEqual(await leer(historico.id_pozo), valor);
      }
    });
    await context.test('rangos inválidos y exceso en altas/ediciones se rechazan sin efectos persistidos', async () => {
      for (const invalido of [{ desde_m: -1, hasta_m: 2 }, { desde_m: 2, hasta_m: 2 }, { desde_m: 3, hasta_m: 2 }, { desde_m: 0, hasta_m: 31 }]) {
        const antes = await snapshot();
        await assert.rejects(crearPozoCompleto(3, { ...cuerpo(), sello_sanitario_constructivo: invalido }, fotos, pool), { statusCode: 400 });
        await assert.rejects(crearHistorico(1, { numero_perforacion: 2099, profundidad_final_m: 30, sello_sanitario_constructivo: invalido }, randomUUID(), epoca, pool), { statusCode: 400 });
        await assert.rejects(actualizarPozoCompleto(normal.pozo.id_pozo, edicion(invalido), fotos, pool), { statusCode: 400 });
        await assert.rejects(editarHistorico(1, historico.id_pozo, { sello_sanitario_constructivo: invalido }, pool), { statusCode: 400 });
        assert.deepEqual(await snapshot(), antes);
      }
    });
    await context.test('reducción incompatible normal, histórica y legada revierte todo; reducir junto con sello sí es válido', async () => {
      const antes = await snapshot();
      const body = edicion(); body.pozo.profundidad_final_m = 8; body.intervalos_litologicos = [];
      await assert.rejects(actualizarPozoCompleto(normal.pozo.id_pozo, body, fotos, pool), /sello sanitario constructivo excede/);
      await assert.rejects(editarHistorico(1, historico.id_pozo, { profundidad_final_m: 8, empresa: 'No debe persistir' }, pool), /sello sanitario constructivo excede/);
      await assert.rejects(updatePozo(normal.pozo.id_pozo, { id_propietario: 2, profundidad_final_m: 8, empresa: 'No debe persistir' }), /sello sanitario constructivo excede/);
      assert.deepEqual(await snapshot(), antes);
      body.sello_sanitario_constructivo = { desde_m: 1, hasta_m: 8 };
      normal = await actualizarPozoCompleto(normal.pozo.id_pozo, body, fotos, pool);
      await editarHistorico(1, historico.id_pozo, { profundidad_final_m: 8, sello_sanitario_constructivo: null, intervalos_litologicos: [] }, pool);
      assert.deepEqual(await leer(normal.pozo.id_pozo), { desde_m: 1, hasta_m: 8 });
      assert.equal(await leer(historico.id_pozo), null);
    });
    await context.test('histórico sin profundidad admite sello; informar profundidad incompatible se rechaza', async () => {
      const creado = await crearHistorico(1, { numero_perforacion: 2098, sello_sanitario_constructivo: sello }, randomUUID(), epoca, pool);
      assert.deepEqual(await leer(creado.id_pozo), sello);
      await assert.rejects(editarHistorico(1, creado.id_pozo, { profundidad_final_m: 5 }, pool), /excede/);
      assert.equal((await pool.query('SELECT profundidad_final_m FROM pozo WHERE id_pozo=$1', [creado.id_pozo])).rows[0].profundidad_final_m, null);
    });
    await context.test('id reservado y provisional exacto fallan en altas, edición y CRUD individual; similares funcionan', async () => {
      const idSello = Number((await pool.query("SELECT id_litologia FROM catalogo_litologia WHERE codigo='sello_sanitario'")).rows[0].id_litologia);
      for (const litologia of [
        { desde_m: 0, hasta_m: 2, material: 'Cliente viejo', id_litologia: idSello },
        { desde_m: 0, hasta_m: 2, material: 'Sello sanitario', litologia_provisional: 'Sello sanitario' },
        { desde_m: 0, hasta_m: 2, material: 'sello_sanitario' },
      ]) {
        const antes = await snapshot();
        await assert.rejects(crearPozoCompleto(3, { ...cuerpo(), intervalos_litologicos: [litologia] }, fotos, pool), /constructivo/);
        await assert.rejects(crearHistorico(1, { numero_perforacion: 2097, intervalos_litologicos: [litologia] }, randomUUID(), epoca, pool), /constructivo/);
        await assert.rejects(actualizarPozoCompleto(normal.pozo.id_pozo, { ...edicion(), intervalos_litologicos: [litologia] }, fotos, pool), /constructivo/);
        await assert.rejects(editarHistorico(1, historico.id_pozo, { intervalos_litologicos: [litologia] }, pool), /constructivo/);
        await assert.rejects(createIntervaloLitologico(normal.pozo.id_pozo, litologia), /constructivo/);
        await assert.rejects(updateIntervaloLitologico(normal.pozo.id_pozo, 999, litologia), /constructivo/);
        assert.deepEqual(await snapshot(), antes);
      }
      await assert.rejects(cambiarEstadoLitologia(idSello, true), /constructivo/);
      assert.ok(!(await listarLitologias()).some(item => item.codigo === 'sello_sanitario'));
      await contextoEscritura.run({ idUsuario: 3, versionSesion: 1 }, async () => {
        const real = await createIntervaloLitologico(normal.pozo.id_pozo, { desde_m: 0, hasta_m: 4, material: 'Terreno', id_litologia: 1 });
        assert.equal(real.id_litologia, 1);
        const provisional = await createIntervaloLitologico(normal.pozo.id_pozo, { desde_m: 4, hasta_m: 8, material: 'Sello sanitario parecido', litologia_provisional: 'Sello sanitario parecido' });
        assert.equal(provisional.litologia_provisional, 'Sello sanitario parecido');
      });
      assert.deepEqual(await leer(normal.pozo.id_pozo), { desde_m: 1, hasta_m: 8 });
    });
    await context.test('fallo posterior al guardado del sello revierte creación y edición normal/histórica', async () => {
      const antes = await snapshot();
      const inexistente = { desde_m: 0, hasta_m: 2, material: 'No existe', id_litologia: 999999 };
      await assert.rejects(crearPozoCompleto(3, { ...cuerpo(), intervalos_litologicos: [inexistente] }, fotos, pool));
      await assert.rejects(actualizarPozoCompleto(normal.pozo.id_pozo, { ...edicion({ desde_m: 2, hasta_m: 6 }), intervalos_litologicos: [inexistente] }, fotos, pool));
      await assert.rejects(editarHistorico(1, historico.id_pozo, { sello_sanitario_constructivo: { desde_m: 2, hasta_m: 6 }, intervalos_litologicos: [inexistente] }, pool));
      await assert.rejects(crearHistorico(1, { numero_perforacion: 2096, sello_sanitario_constructivo: sello, foto: { mime_type: 'image/png', base64: 'foto-invalida' } }, randomUUID(), epoca, pool));
      assert.deepEqual(await snapshot(), antes);
    });
    await context.test('detalle y consulta técnica exponen rango y null; serialización HTTP preserva el nuevo contrato', async () => {
      const detalle = await getPozoById(normal.pozo.id_pozo);
      assert.deepEqual(detalle?.sello_sanitario_constructivo, { desde_m: 1, hasta_m: 8 });
      assert.deepEqual((await getReportePozo(normal.pozo.id_pozo, pool))?.sello_sanitario_constructivo, detalle?.sello_sanitario_constructivo);
      assert.equal((await getPozoById(historico.id_pozo))?.sello_sanitario_constructivo, null);
      const Fastify = (await import('fastify')).default;
      const { PozoDetalle } = await import('../src/models/schemas.ts');
      const app = Fastify(); cerrarAplicacion = () => app.close();
      app.get('/detalle', { schema: { response: { 200: PozoDetalle } } }, async () => detalle);
      const respuesta = await app.inject({ method: 'GET', url: '/detalle' });
      assert.equal(respuesta.statusCode, 200, respuesta.body);
      assert.deepEqual(respuesta.json().sello_sanitario_constructivo, { desde_m: 1, hasta_m: 8 });
    });
    await context.test('regresiones existentes de históricos y provisionales con 020 en el mismo laboratorio', async () => {
      await control.query(`CREATE ROLE rsp_reset_test LOGIN CREATEDB PASSWORD '${password}'`);
      const salida = execFileSync(process.execPath, ['--test', '--experimental-strip-types',
        'test/historicos.postgres.local.ts', 'test/provisionales.postgres.local.ts'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, encoding: 'utf8', timeout: 60_000,
        env: { ...env, NODE_ENV: 'test', PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'rsp_reset_test',
          PGPASSWORD: password, PGDATABASE: 'postgres', RSP_RESET_TEST_PORT: String(port),
          FOTOS_DIR: path.join(root, 'fotos-regresion'), FASTIFY_SECRET: 'sello-regresion-local-secret' },
      });
      assert.match(salida, /tests [1-9][0-9]*/);
      process.stdout.write(salida);
    });
  } finally {
    await cerrarAplicacion?.();
    await cerrarPoolAplicacion?.();
    await Promise.all(pools.map(pool => pool.end()));
    if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']);
    const resolvedRoot = await realpath(root);
    const resolvedTemp = await realpath(tmpdir());
    assert.ok(resolvedRoot.toLowerCase().startsWith((resolvedTemp + path.sep + 'rsp-sello-').toLowerCase()));
    await rm(resolvedRoot, { recursive: true, force: true });
  }
});
