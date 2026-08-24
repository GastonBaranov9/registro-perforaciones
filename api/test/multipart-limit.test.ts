import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import multipart from "../src/plugins/multipart.ts";
import { MAX_FOTO_BYTES } from "../src/constants/fotos.ts";

function bodyMultipart(bytes: number, boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="foto"; filename="foto.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    Buffer.alloc(bytes, 1),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test("multipart acepta hasta 5 MB y devuelve 413 al superar el contrato", async () => {
  const app = Fastify();
  await app.register(multipart);
  app.post("/upload", async (req) => {
    const archivo = await req.file();
    if (!archivo) return { bytes: 0 };
    return { bytes: (await archivo.toBuffer()).length };
  });

  const boundary = "rsp07b-boundary";
  const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  const aceptada = await app.inject({ method: "POST", url: "/upload", headers, payload: bodyMultipart(MAX_FOTO_BYTES, boundary) });
  assert.equal(aceptada.statusCode, 200);
  assert.equal(aceptada.json().bytes, MAX_FOTO_BYTES);

  const rechazada = await app.inject({ method: "POST", url: "/upload", headers, payload: bodyMultipart(MAX_FOTO_BYTES + 1, boundary) });
  assert.equal(rechazada.statusCode, 413);
  await app.close();
});
