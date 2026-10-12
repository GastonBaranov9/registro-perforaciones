import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { myPool } from '../src/db/pool.ts';
import pozoRoutes from '../src/routes/pozos.ts';

const casos = [
  ['administracion'], ['perforador'], ['propietario'], ['operador_administrativo'], ['operador_administrativo', 'perforador', 'propietario'],
  ['administracion', 'perforador'], ['administracion', 'propietario'],
  ['administracion', 'perforador', 'propietario'], ['propietario', 'perforador'], [],
];
for (const roles of casos) {
  test(`GET pozos: ${roles.join(' + ') || 'sin permisos'} usa alcance de sesión`, async () => {
    const consultas: { sql: string; params?: unknown[] }[] = [];
    const original = myPool.query;
    const admin = roles.includes('administracion') || roles.includes('operador_administrativo');
    const alcance = admin ? '1=1' : roles.includes('propietario') ? 'id_propietario = $1' : 'id_perforador = $1';
    myPool.query = (async (sql: string, params?: unknown[]) => {
      consultas.push({ sql, params });
      if (sql.includes('FROM rol r')) {
        assert.deepEqual(params, [7]);
        return { rows: roles.map((nombre, i) => ({ id_rol: i + 1, nombre, descr: nombre })) };
      }
      assert.ok(sql.includes(`WHERE ${alcance}`), sql);
      assert.deepEqual(params, admin ? [50, 2000, 60, 5, true] : [7, 50, 2000, 60, 5, true]);
      assert.match(sql, /prop.nombre.*AS propietario_nombre/);
      assert.match(sql, /AS sitio_nombre/);
      assert.match(sql, /LEFT JOIN public.usuario prop/);
      assert.match(sql, /LEFT JOIN public.sitio s/);
      return { rows: [{ id_pozo: 1, id_propietario: admin ? 99 : 7, id_perforador: 7, id_sitio: 1, fecha_creado: '2026-09-01T00:00:00Z', propietario_nombre: 'José Pérez', sitio_nombre: 'Paso de los Mellizos, Río Negro' }] };
    }) as typeof myPool.query;
    const app = Fastify();
    app.decorate('authenticate', async req => { (req as unknown as { user: { sub: number } }).user = { sub: 7 }; });
    for (const hook of ['puedeOperarTodosLosPozos', 'userIsAdmin', 'pozoIsFromUser', 'puedeOperarPozos', 'puedeConsultarRecursos']) app.decorate(hook, async () => {});
    try {
      await app.register(pozoRoutes);
      // URL deliberately differs: identity must come from authenticated sub.
      const respuesta = await app.inject({ method: 'GET', url: '/usuarios/999/pozos?caudal_min=50&caudal_max=2000&profundidad_min=5&profundidad_max=60&sello_sanitario=true' });
      assert.equal(respuesta.statusCode, roles.length ? 200 : 403, respuesta.body);
      const lecturas = consultas.filter(q => q.sql.includes('FROM public.pozo'));
      assert.equal(lecturas.length, roles.length ? 1 : 0);
      if (roles.length) {
        assert.equal(respuesta.json()[0].id_pozo, 1);
        assert.equal(respuesta.json()[0].propietario_nombre, 'José Pérez');
        assert.equal(respuesta.json()[0].sitio_nombre, 'Paso de los Mellizos, Río Negro');
      }
    } finally { myPool.query = original; await app.close(); }
  });
}
