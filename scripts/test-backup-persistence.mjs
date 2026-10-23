// Real PostgreSQL + disposable filesystem. Never uses a production Compose file.
import {execFileSync, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const image='postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const name='rsp-backup-test-'+randomUUID().slice(0,8);
const hostBackup=fs.mkdtempSync(path.join(os.tmpdir(),name+'-'));
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let created=false;
try {
  docker(['image','inspect',image]);
  docker(['run','-d','--pull','never','--name',name,'--label','com.docker.compose.project='+name,
    '--network','none','--memory','384m','--cpus','1','--pids-limit','128',
    '-e','POSTGRES_USER=fixture','-e','POSTGRES_PASSWORD=discardable-fixture-only','-e','POSTGRES_DB=fixture',
    '--mount',`type=bind,source=${path.join(repo,'ops')},target=/source-ops,readonly`,
    '--mount',`type=bind,source=${path.join(repo,'scripts')},target=/source-tests,readonly`,
    '--mount',`type=bind,source=${hostBackup},target=/backup-host`,image]);
  created=true;
  const c=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(c.Config.Labels['com.docker.compose.project'],name);
  assert.equal(c.HostConfig.NetworkMode,'none');
  assert.equal(Object.keys(c.HostConfig.PortBindings??{}).length,0);
  assert.equal(c.HostConfig.Memory,384*1024*1024);
  assert(c.Mounts.every(m=>m.Type==='volume' ? m.Destination==='/var/lib/postgresql/data' :
    m.Destination==='/backup-host' ? m.RW && m.Source.toLowerCase().replaceAll('\\','/').endsWith(path.basename(hostBackup).toLowerCase()) :
    !m.RW && ['/source-ops','/source-tests'].includes(m.Destination)));
  let ready=false;
  for(let i=0;i<30;i++){
    if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','fixture','-d','fixture'],{stdio:'ignore'}).status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert(ready,'Disposable PostgreSQL did not become ready');
  const result=spawnSync('docker',['exec','-e','PGHOST=127.0.0.1','-e','PGPORT=5432','-e','PGUSER=fixture',
    '-e','PGPASSWORD=discardable-fixture-only','-e','PGDATABASE=fixture',name,'sh','-c',
    'tr -d "\\r" </source-tests/test-backup-persistence.sh >/tmp/test.sh; sh /tmp/test.sh'],{encoding:'utf8'});
  process.stdout.write(result.stdout??'');
  if(result.status!==0){process.stderr.write((result.stderr??'').slice(-5000));throw Error('Isolated backup test failed');}
} finally {
  if(created){
    // Check identity again before stopping ONLY this freshly created resource.
    const c=JSON.parse(docker(['inspect',name]))[0];
    assert.equal(c.Config.Labels['com.docker.compose.project'],name);
    assert.equal(c.HostConfig.NetworkMode,'none');
    docker(['stop',name]);
    console.log('DISPOSABLE_TEST_RETAINED_STOPPED='+name);
    console.log('SYNTHETIC_BACKUP_RETAINED='+hostBackup);
  }
}
