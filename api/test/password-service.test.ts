import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/services/password-service.ts";

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
