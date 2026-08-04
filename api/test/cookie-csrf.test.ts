import assert from "node:assert/strict";
import test from "node:test";
import { cookieOptions, SESSION_MAX_AGE_SECONDS } from "../src/plugins/cookies.ts";
import { csrfValido } from "../src/plugins/csrf.ts";

test("la cookie de sesiÃ³n es HttpOnly y la cookie CSRF es legible", () => {
  const session = cookieOptions(true);
  const csrf = cookieOptions(false);

  assert.equal(session.httpOnly, true);
  assert.equal(csrf.httpOnly, false);
  assert.equal(session.sameSite, "lax");
  assert.equal(session.path, "/");
  assert.equal(session.maxAge, SESSION_MAX_AGE_SECONDS);
});

test("Secure se activa solamente en producciÃ³n", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.equal(cookieOptions(true).secure, true);
  process.env.NODE_ENV = "development";
  assert.equal(cookieOptions(true).secure, false);
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
});

test("CSRF exige valores no vacÃ­os e idÃ©nticos", () => {
  assert.equal(csrfValido("secreto", "secreto"), true);
  assert.equal(csrfValido("secreto", "distinto"), false);
  assert.equal(csrfValido("", ""), false);
  assert.equal(csrfValido(undefined, "secreto"), false);
  assert.equal(csrfValido("secreto", ["secreto"]), false);
});
