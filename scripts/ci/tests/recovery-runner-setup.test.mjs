import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('Linux registration protocol checks archive, path and one-job labels without contacting GitHub', {skip:process.platform!=='linux'},()=>{
 const root=mkdtempSync(join(tmpdir(),'iot-runner-protocol-')),bundle=join(root,'bundle');mkdirSync(bundle);
 const token=randomUUID();
 try {
  // A synthetic config.sh substitutes only the external GitHub runner binary.
  // Host checks, archive hash and extraction execute unchanged on real Linux.
  writeFileSync(join(bundle,'config.sh'),'#!/bin/bash\nset -euo pipefail\nseen_ephemeral=false\nseen_labels=false\nfor arg in "$@"; do\n [[ "$arg" != --ephemeral ]] || seen_ephemeral=true\n [[ "$arg" != iot-manager-recovery ]] || seen_labels=true\ndone\n[[ "$seen_ephemeral" == true && "$seen_labels" == true ]]\nprintf configured > protocol.marker\n',{mode:0o755});
  const archive=join(root,'runner.tar.gz'),pack=spawnSync('tar',['-czf',archive,'-C',bundle,'config.sh']);assert.equal(pack.status,0);
  const hash=createHash('sha256').update(readFileSync(archive)).digest('hex'),home=join(root,'runner');
  const env={...process.env,IOT_RUNNER_HOME:home,IOT_RUNNER_REPOSITORY:'owner/repo',IOT_RUNNER_ARCHIVE:archive,IOT_RUNNER_ARCHIVE_SHA256:hash,
   IOT_RUNNER_NAME:'isolated-protocol-test',IOT_RUNNER_REGISTRATION_TOKEN:token};
  const script=resolve(import.meta.dirname,'../../ops/recovery-runner.sh');
  const invoke=extra=>spawnSync('bash',[script,'register'],{env:{...env,...extra},encoding:'utf8'});
  assert.notEqual(invoke({IOT_RUNNER_ARCHIVE_SHA256:'0'.repeat(64)}).status,0);assert.equal(existsSync(home),false);
  assert.notEqual(invoke({IOT_RUNNER_HOME:resolve('.')}).status,0);
  const result=invoke({});assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(home,'protocol.marker'),'utf8'),'configured');
  assert.ok(!result.stdout.includes(token)&&!result.stderr.includes(token));
  assert.notEqual(invoke({}).status,0,'Existing runner directory must not be replaced');
 }finally{assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir())+sep+'iot-runner-protocol-'));rmSync(root,{recursive:true});}
});
