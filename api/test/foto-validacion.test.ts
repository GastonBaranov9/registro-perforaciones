import assert from "node:assert/strict";
import test from "node:test";
import { decodificarFotoBase64, validarFotoBuffer } from "../src/services/foto-archivo-service.ts";

const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]);
test("acepta firmas JPEG y PNG completas y coherentes",()=>{assert.equal(validarFotoBuffer(jpeg,"image/jpeg").extension,"jpg");assert.equal(validarFotoBuffer(png,"image/png").extension,"png");});
test("rechaza firmas parciales y MIME cruzado",()=>{assert.throws(()=>validarFotoBuffer(Buffer.from([0xff,0xd8,1]),"image/jpeg"));assert.throws(()=>validarFotoBuffer(Buffer.from([0x89,0x50,0x4e,0x47]),"image/png"));assert.throws(()=>validarFotoBuffer(png,"image/jpeg"));assert.throws(()=>validarFotoBuffer(jpeg,"image/png"));});
test("base64 exige caracteres estructura y padding canónicos",()=>{assert.throws(()=>decodificarFotoBase64("%%%=" ,"image/png"));assert.throws(()=>decodificarFotoBase64("AAAA=","image/png"));assert.throws(()=>decodificarFotoBase64("A===","image/png"));assert.throws(()=>decodificarFotoBase64("","image/png"));assert.equal(decodificarFotoBase64(png.toString("base64"),"image/png").buffer.length,png.length);});
test("rechaza fotografía decodificada superior a 5 MB",()=>{const grande=Buffer.alloc(5_000_001);grande.set(jpeg);assert.throws(()=>validarFotoBuffer(grande,"image/jpeg"),/5 MB/);});
