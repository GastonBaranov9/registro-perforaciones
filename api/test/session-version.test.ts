import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizarEnteroPositivoSeguro,
  sesionVigente,
} from "../src/plugins/jwt.ts";
import {
  canonicalizarIdsRol,
  debeRevocarSesion,
  mismosIdsRol,
} from "../src/services/usuarios-service.ts";

test("normaliza enteros positivos seguros para el payload JWT", () => {
  assert.equal(normalizarEnteroPositivoSeguro(1), 1);
  assert.equal(normalizarEnteroPositivoSeguro("42"), 42);
});

test("rechaza versiones de sesion invalidas", () => {
  for (const value of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    "0",
    "-1",
    "1.5",
    "01",
    "+1",
    " 1",
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.equal(normalizarEnteroPositivoSeguro(value), null);
  }
});

test("solo acepta usuarios activos con la version vigente", () => {
  assert.equal(sesionVigente({ activo: true, version_sesion: 3 }, 3), true);
  assert.equal(sesionVigente({ activo: false, version_sesion: 3 }, 3), false);
  assert.equal(sesionVigente({ activo: true, version_sesion: 4 }, 3), false);
  assert.equal(sesionVigente(null, 3), false);
});

test("un token anterior no revive despues de reactivar", () => {
  const versionTokenAnterior = 1;
  assert.equal(
    sesionVigente({ activo: false, version_sesion: 2 }, versionTokenAnterior),
    false
  );
  assert.equal(
    sesionVigente({ activo: true, version_sesion: 2 }, versionTokenAnterior),
    false
  );
  assert.equal(sesionVigente({ activo: true, version_sesion: 2 }, 2), true);
});

test("canonicaliza roles como conjunto independiente de orden y duplicados", () => {
  const ids = canonicalizarIdsRol([
    { id_rol: "20" as unknown as number },
    { id_rol: 10 },
    { id_rol: 20 },
  ]);

  assert.deepEqual(ids, [10, 20]);
  assert.equal(mismosIdsRol([10, 20], ids), true);
});

test("revoca por password, desactivacion o cambio efectivo de roles", () => {
  assert.equal(
    debeRevocarSesion({
      passwordCambiado: true,
      estabaActivo: true,
      quedaActivo: true,
      rolesCambiaron: false,
    }),
    true
  );
  assert.equal(
    debeRevocarSesion({
      passwordCambiado: false,
      estabaActivo: true,
      quedaActivo: false,
      rolesCambiaron: false,
    }),
    true
  );
  assert.equal(
    debeRevocarSesion({
      passwordCambiado: false,
      estabaActivo: true,
      quedaActivo: true,
      rolesCambiaron: true,
    }),
    true
  );
});

test("no revoca por cambios no sensibles ni al reactivar", () => {
  assert.equal(
    debeRevocarSesion({
      passwordCambiado: false,
      estabaActivo: true,
      quedaActivo: true,
      rolesCambiaron: false,
    }),
    false
  );
  assert.equal(
    debeRevocarSesion({
      passwordCambiado: false,
      estabaActivo: false,
      quedaActivo: true,
      rolesCambiaron: false,
    }),
    false
  );
});
