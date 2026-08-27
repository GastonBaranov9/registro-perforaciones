import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import errorHandler from "../src/plugins/error-handler.ts";
import nativeAuthRoutes from "../src/routes/native-auth.ts";

const validBody = {
  email: "metadata@example.test",
  password: "NativePassword123!",
  installation_id: randomUUID(),
};

test("login native unifica metadata inválida sin alterar validaciones globales", async () => {
  const previousAndroid = process.env.MIN_NATIVE_ANDROID_BUILD;
  const previousIos = process.env.MIN_NATIVE_IOS_BUILD;
  process.env.MIN_NATIVE_ANDROID_BUILD = "120";
  process.env.MIN_NATIVE_IOS_BUILD = "220";

  const app = Fastify({ logger: false });
  let loginRateLimitCalls = 0;
  app.decorate("rateLimitLogin", async () => {
    loginRateLimitCalls += 1;
  });
  app.decorate("authenticateNative", async () => undefined);
  app.decorate("authenticateNativeAllowObsolete", async () => undefined);
  app.decorate("rateLimitNativeWsTicket", async () => undefined);
  await app.register(errorHandler);
  await app.register(nativeAuthRoutes);
  app.post(
    "/schema-regression",
    { schema: { body: Type.Object({ quantity: Type.Integer() }) } },
    async () => ({ ok: true }),
  );
  await app.ready();

  try {
    const invalidCases: Array<{ label: string; headers: Record<string, string | string[]> }> = [
      {
        label: "platform ausente",
        headers: { "x-native-app-build": "120" },
      },
      {
        label: "platform vacía",
        headers: { "x-native-platform": "", "x-native-app-build": "120" },
      },
      {
        label: "platform desconocida",
        headers: { "x-native-platform": "windows", "x-native-app-build": "120" },
      },
      {
        label: "platform duplicada",
        headers: { "x-native-platform": ["android", "ios"], "x-native-app-build": "120" },
      },
      {
        label: "build ausente",
        headers: { "x-native-platform": "android" },
      },
      {
        label: "build vacío",
        headers: { "x-native-platform": "android", "x-native-app-build": "" },
      },
      {
        label: "build alfabético",
        headers: { "x-native-platform": "android", "x-native-app-build": "abc" },
      },
      {
        label: "build decimal",
        headers: { "x-native-platform": "android", "x-native-app-build": "120.5" },
      },
      {
        label: "build negativo",
        headers: { "x-native-platform": "android", "x-native-app-build": "-1" },
      },
      {
        label: "build cero",
        headers: { "x-native-platform": "android", "x-native-app-build": "0" },
      },
      {
        label: "build ambiguo",
        headers: { "x-native-platform": "android", "x-native-app-build": "0120" },
      },
      {
        label: "build fuera de rango",
        headers: { "x-native-platform": "android", "x-native-app-build": "2147483648" },
      },
      {
        label: "app version vacía",
        headers: {
          "x-native-platform": "android",
          "x-native-app-build": "120",
          "x-native-app-version": "",
        },
      },
      {
        label: "app version demasiado larga",
        headers: {
          "x-native-platform": "android",
          "x-native-app-build": "120",
          "x-native-app-version": "v".repeat(81),
        },
      },
    ];

    for (const fixture of invalidCases) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/native/login",
        headers: fixture.headers,
        payload: validBody,
      });
      assert.equal(response.statusCode, 400, fixture.label);
      assert.equal(response.json().code, "ERR_NATIVE_METADATA_T05", fixture.label);
      assert.notEqual(response.json().code, "FST_ERR_VALIDATION", fixture.label);
    }

    const knownShape = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: { "x-native-platform": "android" },
      payload: validBody,
    });
    const unknownShape = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: { "x-native-platform": "android" },
      payload: {
        email: "not-an-email",
        password: "incorrecta",
        installation_id: randomUUID(),
      },
    });
    assert.deepEqual(unknownShape.json(), knownShape.json());

    const obsolete = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: {
        "x-native-platform": "android",
        "x-native-app-build": "119",
      },
      payload: validBody,
    });
    assert.equal(obsolete.statusCode, 426);
    assert.equal(obsolete.json().code, "NATIVE_APP_UPGRADE_REQUIRED");

    const validMetadata = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: {
        "x-native-platform": "android",
        "x-native-app-build": "120",
      },
      payload: { email: "metadata@example.test", password: "NativePassword123!" },
    });
    assert.equal(validMetadata.statusCode, 400);
    assert.equal(validMetadata.json().code, "FST_ERR_VALIDATION");

    const unrelatedSchema = await app.inject({
      method: "POST",
      url: "/schema-regression",
      payload: { quantity: "not-an-integer" },
    });
    assert.equal(unrelatedSchema.statusCode, 400);
    assert.equal(unrelatedSchema.json().code, "FST_ERR_VALIDATION");
    assert.equal(loginRateLimitCalls, invalidCases.length + 4);
  } finally {
    await app.close();
    if (previousAndroid === undefined) delete process.env.MIN_NATIVE_ANDROID_BUILD;
    else process.env.MIN_NATIVE_ANDROID_BUILD = previousAndroid;
    if (previousIos === undefined) delete process.env.MIN_NATIVE_IOS_BUILD;
    else process.env.MIN_NATIVE_IOS_BUILD = previousIos;
  }
});
