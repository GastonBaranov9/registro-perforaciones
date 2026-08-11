import assert from "node:assert/strict";
import test from "node:test";
import { myPool } from "../src/db/pool.ts";
import * as err from "../src/models/errors.ts";
import {
  deleteUsuario,
  getAllUsuarios,
  getUsuarioById,
  updateUsuario,
} from "../src/services/usuarios-service.ts";
import { changeRol } from "../src/services/roles-services.ts";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;

function reemplazarQuery(query: Query): () => void {
  const pool = myPool as typeof myPool & { query: Query };
  const original = pool.query;
  pool.query = query;
  return () => { pool.query = original; };
}

test("el listado administrativo solo consulta cuentas de acceso", async () => {
  let sql = "";
  const restaurar = reemplazarQuery(async (consulta) => { sql = consulta; return { rows: [] }; });
  try {
    assert.deepEqual(await getAllUsuarios(), []);
    assert.match(sql, /u\.cuenta_acceso = TRUE/);
  } finally { restaurar(); }
});

test("el detalle administrativo excluye identidades operativas", async () => {
  let sql = "";
  const restaurar = reemplazarQuery(async (consulta) => { sql = consulta; return { rows: [] }; });
  try {
    assert.equal(await getUsuarioById(91), null);
    assert.match(sql, /u\.cuenta_acceso = TRUE/);
  } finally { restaurar(); }
});

test("editar y borrar no alcanzan una identidad sin cuenta", async () => {
  const consultas: string[] = [];
  const client = {
    async query(sql: string) {
      consultas.push(sql);
      if (sql.includes("SELECT activo")) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = myPool as typeof myPool & { connect: () => Promise<typeof client> };
  const connectOriginal = pool.connect;
  const queryOriginal = pool.query;
  pool.connect = async () => client;
  pool.query = async (sql) => { consultas.push(sql); return { rows: [], rowCount: 0 }; };
  try {
    assert.equal(await updateUsuario({ email: "cuenta@example.test", nombre: "Cuenta", activo: true, roles: [] }, 91), null);
    await assert.rejects(() => deleteUsuario(91), err.T05UsuarioNoEncontrado);
    assert.match(consultas.find((sql) => sql.includes("SELECT activo")) ?? "", /cuenta_acceso = TRUE/);
    assert.match(consultas.find((sql) => sql.includes("DELETE FROM usuario")) ?? "", /cuenta_acceso = TRUE/);
  } finally {
    pool.connect = connectOriginal;
    pool.query = queryOriginal;
  }
});

test("el CRUD de roles rechaza identidades operativas antes de mutar", async () => {
  const consultas: string[] = [];
  const client = {
    async query(sql: string) { consultas.push(sql); if (sql.includes("SELECT id_usuario")) return { rows: [] }; return { rows: [] }; },
    release() {},
  };
  const pool = myPool as typeof myPool & { connect: () => Promise<typeof client> };
  const original = pool.connect;
  pool.connect = async () => client;
  try {
    await assert.rejects(() => changeRol(91, 3), err.T05UsuarioNoEncontrado);
    assert.match(consultas[1] ?? "", /cuenta_acceso = TRUE/);
    assert.equal(consultas.some((sql) => sql.includes("INSERT INTO usuario_rol") || sql.includes("DELETE FROM usuario_rol")), false);
  } finally { pool.connect = original; }
});
