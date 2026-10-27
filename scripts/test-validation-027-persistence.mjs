import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../ops/validation-027-persistence.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const sha=s=>createHash('sha256').update(s).digest('hex');
function inventory(change=()=>{}){
  const files={'.':{dir:true,children:['fotos','.archivo']},'./fotos':{dir:true,children:['demo.jpg']},'./fotos/demo.jpg':{content:'synthetic'},'./.archivo':{content:'archived'}};
  change(files);let result;
  const relative=p=>p==='/var/lib/registro-perforaciones'?'.':'./'+p.slice('/var/lib/registro-perforaciones/'.length);
  vm.runInNewContext(source,{
    path:path.posix,Buffer,createHash,
    lstatSync:p=>{const f=files[relative(p)];if(!f)throw Error('Unexpected path');return {mode:f.mode??(f.dir?0o755:0o644),uid:1000,gid:1000,size:Buffer.byteLength(f.content??''),isDirectory:()=>!!f.dir,isFile:()=>!f.dir&&!f.link};},
    readdirSync:p=>files[relative(p)].children,
    readFileSync:p=>Buffer.from(files[relative(p)].content),
    console:{log:s=>{result=JSON.parse(s);}},
  });
  return result;
}
test('inventory matches backup format, byte order and SHA-256, including archived files',()=>{
  const expected=['d 755:1000:1000 .','f 644:1000:1000 '+sha('archived')+' 8 ./.archivo','d 755:1000:1000 ./fotos','f 644:1000:1000 '+sha('synthetic')+' 9 ./fotos/demo.jpg'].join('\n')+'\n';
  assert.deepEqual(inventory(),{sha256:sha(expected),entries:4});
});
test('changed photograph detected',()=>assert.notEqual(inventory(f=>f['./fotos/demo.jpg'].content='changed').sha256,inventory().sha256));
test('missing archive detected',()=>assert.notEqual(inventory(f=>f['.'].children=['fotos']).sha256,inventory().sha256));
test('permissions detected',()=>assert.notEqual(inventory(f=>f['./fotos'].mode=0o700).sha256,inventory().sha256));
test('symlink rejected',()=>assert.throws(()=>inventory(f=>f['./.archivo'].link=true),/Unsupported/));
test('unfinished restore directory rejected',()=>assert.throws(()=>inventory(f=>f['.'].children=['.rsp-restore-incomplete']),/Unsupported/));
