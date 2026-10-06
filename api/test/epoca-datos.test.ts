import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exigirEpoca } from '../src/services/epoca-datos-service.ts';

test('época: ausente, antigua y malformada son rechazo definitivo; actual toma lock compartido', async () => {
  const actual=randomUUID(); const queries:string[]=[];
  const db={query:async(sql:string)=>{queries.push(sql);return {rows:[{epoca:actual}]};}} as any;
  for(const value of [undefined,null,'',1,'not-uuid',randomUUID()]) await assert.rejects(exigirEpoca(db,value),{statusCode:410,code:'EPOCA_DATOS_RETIRADA'});
  assert.equal(await exigirEpoca(db,actual.toUpperCase()),actual);
  assert.ok(queries.every(q=>q.includes('FOR SHARE')));
});
