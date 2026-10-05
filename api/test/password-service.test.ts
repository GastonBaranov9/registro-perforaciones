import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/services/password-service.ts";

test('rechaza explícitamente password vacío', async () => {
  await assert.rejects(hashPassword(''), /al menos 8/);
});
test('acepta exactamente el mínimo vigente de ocho caracteres', async () => {
  assert.equal(await verifyPassword('12345678', await hashPassword('12345678')), true);
});
test('bcrypt limita bytes UTF-8, no sólo caracteres, y acepta exactamente 72 bytes', async () => {
  await assert.rejects(hashPassword('a'.repeat(73)), /72 bytes/);
  await assert.rejects(hashPassword('á'.repeat(37)), /72 bytes/);
  assert.equal(await verifyPassword('á'.repeat(36), await hashPassword('á'.repeat(36))), true);
});

test("rechaza contraseñas de menos de ocho caracteres", async () => {
  await assert.rejects(
    hashPassword("abc1234"),
    /La contraseña debe tener al menos 8 caracteres/
  );
});

test("rechaza contraseñas formadas exclusivamente por blancos", async () => {
  await assert.rejects(
    hashPassword("        "),
    /La contraseña debe contener al menos un carácter no blanco/
  );
});

test("conserva espacios significativos en una contraseña válida", async () => {
  const password = " clave-123 ";
  const hash = await hashPassword(password);

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("clave-123", hash), false);
});
