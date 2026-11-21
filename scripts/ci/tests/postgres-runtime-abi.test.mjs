import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve(import.meta.dirname,'../../../deploy/postgres/runtime-entrypoint.sh');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
for(const [name,version,marker,expected] of [
 ['new empty cluster',null,null,0],['unknown/glibc cluster','16',null,78],
 ['wrong ABI cluster','16','pg16-glibc',78],['wrong major cluster','17','pg16-musl-alpine3.24-v1',78],
 ['matching cluster','16','pg16-musl-alpine3.24-v1',0]
]) test('PostgreSQL entrypoint '+name,()=>{
 const folder=mkdtempSync(resolve(tmpdir(),'iot-pg-abi-'));
 try {
  const data=resolve(folder,'data');mkdirSync(data);
  writeFileSync(resolve(folder,'docker-entrypoint.sh'),'#!/bin/sh\nprintf "ENTRYPOINT:%s\\n" "$*"\n',{mode:0o755});
  if(version)writeFileSync(resolve(data,'PG_VERSION'),version+'\n');
  if(marker)writeFileSync(resolve(data,'.iot-runtime-abi'),marker+'\n');
  const result=spawnSync(bash,['-c',
   'testbin="$1"; if command -v cygpath >/dev/null 2>&1; then testbin="$(cygpath -u "$testbin")"; fi; export PATH="$testbin:$PATH"; export PGDATA="$2"; exec /bin/sh "$3" postgres',
   'abi-test',folder.replaceAll('\\','/'),data.replaceAll('\\','/'),script.replaceAll('\\','/')],
   {encoding:'utf8',windowsHide:true,env:{...process.env}});
  assert.equal(result.status,expected,result.stderr);
  if(expected===78){assert.match(result.stderr,/Refusing PostgreSQL startup/);assert.ok(!result.stdout.includes('ENTRYPOINT'));}
  else assert.equal(result.stdout.trim(),'ENTRYPOINT:postgres');
  assert.equal(existsSync(resolve(data,'.iot-runtime-abi')),Boolean(marker),'Guard must never label an unknown existing cluster');
  if(version)assert.equal(readFileSync(resolve(data,'PG_VERSION'),'utf8'),version+'\n');
 }finally {
  const actual=realpathSync(folder),parent=realpathSync(tmpdir());
  assert.ok(actual.startsWith(parent+sep+'iot-pg-abi-'));rmSync(actual,{recursive:true});
 }
});
