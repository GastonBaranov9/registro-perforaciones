import assert from "node:assert/strict";
import { myPool } from "../src/db/pool.ts";
import { sesionVigente } from "../src/plugins/jwt.ts";
import { changeRol, getAllRoles } from "../src/services/roles-services.ts";
import {
  createUsuario,
  deleteUsuario,
  updateUsuario,
} from "../src/services/usuarios-service.ts";
import { verifyPassword } from "../src/services/password-service.ts";

const emailTemporal = `codex-session-${Date.now()}@example.invalid`;
const passwordAnterior = "clave temporal 123";
const passwordNueva = " clave nueva 456 ";
let idUsuario: number | null = null;

try {
  const catalogo = await getAllRoles();
  assert.ok(catalogo.length >= 2, "Se requieren al menos dos roles locales");
  const rolInicial = catalogo[0];
  const rolAlternativo = catalogo[1];

  const creado = await createUsuario({
    email: emailTemporal,
    nombre: "Usuario temporal de sesiones",
    password: passwordAnterior,
    activo: true,
    roles: [rolInicial, rolAlternativo],
  });
  idUsuario = creado.id_usuario;

  const estado = async () => {
    const { rows } = await myPool.query<{
      activo: boolean;
      version_sesion: number;
      password: string;
    }>(
      `SELECT activo, version_sesion, password FROM usuario WHERE id_usuario = $1`,
      [idUsuario]
    );
    return rows[0];
  };

  assert.equal((await estado()).version_sesion, 1);

  await updateUsuario(
    {
      email: emailTemporal,
      nombre: "Nombre no sensible actualizado",
      activo: true,
      roles: [
        { ...rolAlternativo },
        { ...rolInicial },
        { ...rolAlternativo },
      ],
    },
    idUsuario
  );
  assert.equal((await estado()).version_sesion, 1);

  await updateUsuario(
    {
      email: emailTemporal,
      nombre: "Nombre no sensible actualizado",
      activo: false,
      roles: [rolInicial, rolAlternativo],
    },
    idUsuario
  );
  assert.equal((await estado()).version_sesion, 2);

  await updateUsuario(
    {
      email: emailTemporal,
      nombre: "Nombre no sensible actualizado",
      activo: true,
      roles: [rolAlternativo, rolInicial],
    },
    idUsuario
  );
  const reactivado = await estado();
  assert.equal(reactivado.version_sesion, 2);
  assert.equal(sesionVigente(reactivado, 1), false);
  assert.equal(sesionVigente(reactivado, 2), true);

  await updateUsuario(
    {
      email: emailTemporal,
      nombre: "Nombre no sensible actualizado",
      password: passwordNueva,
      activo: true,
      roles: [rolInicial, rolAlternativo],
    },
    idUsuario
  );
  const passwordCambiada = await estado();
  assert.equal(passwordCambiada.version_sesion, 3);
  assert.equal(await verifyPassword(passwordAnterior, passwordCambiada.password), false);
  assert.equal(await verifyPassword(passwordNueva, passwordCambiada.password), true);

  await changeRol(idUsuario, rolAlternativo.id_rol);
  assert.equal((await estado()).version_sesion, 4);

  await assert.rejects(
    updateUsuario(
      {
        email: emailTemporal,
        nombre: "Operacion destinada a rollback",
        password: passwordNueva,
        activo: true,
        roles: [{ id_rol: Number.MAX_SAFE_INTEGER, nombre: "invalido", descr: "invalido" }],
      },
      idUsuario
    )
  );
  assert.equal((await estado()).version_sesion, 4);

  console.log("Prueba local de revocacion y rollback: correcta.");
} finally {
  if (idUsuario !== null) {
    await deleteUsuario(idUsuario);
  }
  const { rows: temporales } = await myPool.query<{ cantidad: number }>(
    `SELECT count(*)::integer AS cantidad FROM usuario WHERE email = $1`,
    [emailTemporal]
  );
  assert.equal(temporales[0].cantidad, 0);
  await myPool.end();
}
