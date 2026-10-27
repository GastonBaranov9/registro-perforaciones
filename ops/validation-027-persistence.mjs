// Read-only reproduction of ops/persistence.sh inventory; stdout is only a hash.
import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root='/var/lib/registro-perforaciones';
const entries=[];
function visit(relative){
  if(/[\x00-\x1f\x7f\\]/.test(relative)||/^\.\/\.rsp-(restore|previous)-/.test(relative))throw Error('Unsupported persistence entry');
  const absolute=path.join(root,relative),s=lstatSync(absolute);
  if(!s.isDirectory()&&!s.isFile())throw Error('Unsupported persistence type');
  const metadata=(s.mode&0o7777).toString(8)+':'+s.uid+':'+s.gid;
  const line=s.isDirectory()?`d ${metadata} ${relative}\n`:`f ${metadata} ${createHash('sha256').update(readFileSync(absolute)).digest('hex')} ${s.size} ${relative}\n`;
  entries.push({relative,line});
  if(s.isDirectory())for(const child of readdirSync(absolute))visit(relative+'/'+child);
}
visit('.');
entries.sort((a,b)=>Buffer.compare(Buffer.from(a.relative),Buffer.from(b.relative)));
console.log(JSON.stringify({sha256:createHash('sha256').update(entries.map(e=>e.line).join('')).digest('hex'),entries:entries.length}));
