import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepararDirectorioFotos } from "../src/config/runtime.ts";
import { FOTO_JSON_BODY_LIMIT_BYTES, MAX_FOTO_BASE64_CHARS, MAX_FOTO_BYTES } from "../src/constants/fotos.ts";

test("prepara almacenamiento escribible y .trash en la misma raíz", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07b-fotos-"));
  const fotosDir = path.join(base, "persistentes");
  try {
    await prepararDirectorioFotos({ fotosDir });
    await fs.writeFile(path.join(fotosDir, "prueba.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const trash = await fs.stat(path.join(fotosDir, ".trash"));
    assert.equal(trash.isDirectory(), true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("los límites JSON reflejan exactamente el overhead base64 de 5 MB", () => {
  assert.equal(MAX_FOTO_BYTES, 5_000_000);
  assert.equal(MAX_FOTO_BASE64_CHARS, Math.ceil(MAX_FOTO_BYTES / 3) * 4);
  assert.ok(FOTO_JSON_BODY_LIMIT_BYTES > MAX_FOTO_BASE64_CHARS);
  assert.ok(FOTO_JSON_BODY_LIMIT_BYTES < 7_340_032);
});
