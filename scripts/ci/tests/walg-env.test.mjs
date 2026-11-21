import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=resolve(import.meta.dirname,'../../../deploy/postgres/wal-g-env.sh');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
function fixture(files,mode='s3') {
  const folder=mkdtempSync(resolve(tmpdir(),'iot-walg-test-'));
  try {
    for(const [name,value] of Object.entries(files))writeFileSync(resolve(folder,name),value,{mode:0o600});
    const command=mode==='s3'
      ? 'test "$AWS_ACCESS_KEY_ID" = lab-access && test "$AWS_SECRET_ACCESS_KEY" = lab-secret && printf STARTED'
      : 'test -z "${AWS_ACCESS_KEY_ID:-}" && test -z "${AWS_SECRET_ACCESS_KEY:-}" && printf STARTED';
    return spawnSync(bash,[script,bash,'-c',command],{encoding:'utf8',windowsHide:true,
      env:{...process.env,WALG_STORAGE_MODE:mode,WALG_S3_PREFIX:'s3://test-only/prefix',AWS_REGION:'us-east-1',
        WALG_SECRET_DIR:folder.replaceAll('\\','/'),WALG_FILE_PREFIX:resolve(folder,'repository').replaceAll('\\','/'),
        AWS_ACCESS_KEY_ID:'inherited-must-not-be-used',AWS_SECRET_ACCESS_KEY:'inherited-must-not-be-used'}});
  } finally {
    const actual=realpathSync(folder),parent=realpathSync(tmpdir());
    assert.ok(actual.startsWith(parent+sep+'iot-walg-test-'),'Refuse cleanup outside this test temporary directory');
    rmSync(actual,{recursive:true});
  }
}
for(const [name,files] of [['missing',{}],['empty',{walg_s3_access_key:''}],['partial',{walg_s3_access_key:'lab-access'}]]) {
  test('WAL-G refuses '+name+' credentials before executing its child',()=>{
    const result=fixture(files);assert.equal(result.status,78,result.stderr);
    assert.ok(!result.stdout.includes('STARTED'));assert.match(result.stderr,/Required WAL-G secret/);
  });
}
test('WAL-G exports both scoped S3 credentials only after successful reads',()=>{
  const result=fixture({walg_s3_access_key:'lab-access',walg_s3_secret_key:'lab-secret'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'STARTED');
});
test('filesystem mode clears inherited S3 credentials and needs no secret files',()=>{
  const result=fixture({},'filesystem');assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'STARTED');
});
