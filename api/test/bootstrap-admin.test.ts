import assert from "node:assert/strict";
import test from "node:test";
import {
  BootstrapAdminError,
  crearPrimerAdministrador,
  validarEntradaBootstrap,
  type BootstrapClient,
} from "../src/services/bootstrap-admin-service.ts";

function dbBootstrap(opciones: { adminExiste?: boolean; falloAsignacion?: boolean; emailDuplicado?: boolean } = {}) {
  const consultas: Array<{ sql: string; parametros?: unknown[] }> = [];
  let passwordInsertada: string | undefined;
  const client: BootstrapClient = {
    async query(sql, parametros) {
      consultas.push({ sql: sql.trim(), parametros });
      if (sql.includes("WHERE lower(r.nombre)")) return { rows: opciones.adminExiste ? [{ existe: 1 }] : [] };
      if (sql.includes("SELECT id_rol FROM rol")) return { rows: [{ id_rol: 7 }] };
      if (sql.includes("INSERT INTO usuario(")) {
        if (opciones.emailDuplicado) throw Object.assign(new Error("duplicado secreto"), { code: "23505" });
        passwordInsertada = String(parametros?.[2]);
        return { rows: [{ id_usuario: 11 }] };
      }
      if (sql.includes("INSERT INTO usuario_rol") && opciones.falloAsignacion) throw new Error("detalle DB sensible");
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, consultas, password: () => passwordInsertada };
}

const entrada = { email: "admin@example.test", nombre: "Admin inicial", password: "clave control segura" };

test("bootstrap crea una cuenta activa con hash y rol en transacción", async () => {
  const db = dbBootstrap();
  await crearPrimerAdministrador(db.pool, entrada, async () => "hash-bcrypt-control");
  const sql = db.consultas.map((x) => x.sql);
  assert.equal(sql[0], "BEGIN");
  assert.ok(sql.some((x) => x.includes("pg_advisory_xact_lock")));
  assert.ok(sql.some((x) => x.includes("activo,cuenta_acceso")));
  assert.ok(sql.some((x) => x.includes("INSERT INTO usuario_rol")));
  assert.equal(sql.at(-1), "COMMIT");
  assert.equal(db.password(), "hash-bcrypt-control");
  assert.notEqual(db.password(), entrada.password);
});

test("bootstrap rechaza cualquier administrador existente sin modificarlo", async () => {
  const db = dbBootstrap({ adminExiste: true });
  await assert.rejects(crearPrimerAdministrador(db.pool, entrada, async () => "hash"), /Ya existe un administrador/);
  assert.equal(db.consultas.some((x) => x.sql.includes("INSERT INTO usuario(")), false);
  assert.equal(db.consultas.at(-1)?.sql, "ROLLBACK");
});

test("bootstrap valida identidad y política de password", () => {
  assert.throws(() => validarEntradaBootstrap({ ...entrada, email: "no-email" }), /ADMIN_EMAIL/);
  assert.throws(() => validarEntradaBootstrap({ ...entrada, password: "corta" }), /política/);
  assert.throws(() => validarEntradaBootstrap({ ...entrada, password: "        " }), /política/);
});

test("fallo de asignación revierte y no filtra detalles ni password", async () => {
  const db = dbBootstrap({ falloAsignacion: true });
  await assert.rejects(
    crearPrimerAdministrador(db.pool, entrada, async () => "hash"),
    (error: unknown) => {
      assert.ok(error instanceof BootstrapAdminError);
      assert.doesNotMatch(String(error), /detalle DB sensible|clave control segura/);
      return true;
    },
  );
  assert.equal(db.consultas.at(-1)?.sql, "ROLLBACK");
});

test("email perteneciente a otra cuenta se rechaza sin upsert", async () => {
  const db = dbBootstrap({ emailDuplicado: true });
  await assert.rejects(crearPrimerAdministrador(db.pool, entrada, async () => "hash"), /otra cuenta/);
  assert.equal(db.consultas.some((x) => /ON CONFLICT/i.test(x.sql)), false);
});
