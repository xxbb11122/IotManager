import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateConfig,buildPlan,dispatch} from '../../ops/release-operations.mjs';
import {validateMigration,assertTopology,sameInventory} from '../../ops/postgres-migrate.mjs';
import {secretNames} from '../../ops/android-signing.mjs';

const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
const config=()=>({repository:'owner/repo',sourceSha:sha,sourceProject:'approved-source',app:'glass',versionCode:25,versionName:'1.2.0'});
function snapshot() {
 const ok=body=>({ok:true,body});
 return {repository:ok({full_name:'owner/repo',default_branch:'main'}),
  protection:ok({required_status_checks:{strict:true,contexts:['quick-gate']},enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},
   required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true}}),
  environments:Object.fromEntries(['r1-recovery-drill','r1-rollback-drill','android-release'].map(name=>[name,ok({can_admins_bypass:false,deployment_branch_policy:{protected_branches:true},
   protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{id:2}]}]})])),
  runners:ok({runners:[{status:'online',labels:['self-hosted','linux','iot-manager-recovery'].map(name=>({name}))}]})};
}
const metadata=()=>({secrets:secretNames('glass'),variables:{ANDROID_GLASS_CERT_SHA256:'c'.repeat(64),ANDROID_GLASS_LAST_RELEASE_VERSION_CODE:'24'}});
test('operational plan blocks missing governance, signing, old source and unavailable N-1',()=>{
 const c=config(),s=snapshot(),p=buildPlan(c,s,sha,metadata());
 assert.equal(p.productionApproved,false);assert.equal(p.stages.gate.ready,true);assert.equal(p.stages.android.ready,true);assert.equal(p.stages.rollback.ready,false);
 assert.equal(buildPlan(c,s,'f'.repeat(40),metadata()).stages.gate.ready,false);
 assert.equal(buildPlan(c,s,sha,{}).stages.android.ready,false);
 const old=metadata();old.variables.ANDROID_GLASS_LAST_RELEASE_VERSION_CODE='25';assert.equal(buildPlan(c,s,sha,old).stages.android.ready,false);
 s.runners.body.runners=[];assert.equal(buildPlan(c,s,sha,metadata()).stages.gate.ready,false);
});
test('dispatch is exact, approval-gated, never produces a passing release and makes no calls when blocked',()=>{
 const p=buildPlan(config(),snapshot(),sha,metadata()),calls=[];
 const r=dispatch(p,'android',(url,body)=>calls.push({url,...body}));
 assert.equal(r.status,'DISPATCHED');assert.equal(r.productionApproved,false);assert.equal(r.conclusion,'PENDING');
 assert.deepEqual(calls[0].body,{ref:'main',inputs:{source_sha:sha,app:'glass',version_code:'25',version_name:'1.2.0'}});
 assert.throws(()=>dispatch(p,'rollback',()=>assert.fail('must not request')));
 assert.throws(()=>validateConfig({...config(),currentEvidenceDigest:digest,rollbackEvidenceDigest:digest}));
 assert.throws(()=>validateConfig({...config(),sourceSha:'main'}));
 assert.ok(secretNames('client').every(name=>!secretNames('glass').includes(name)));
});
const migration=()=>({id:'lab-migration-1',adminUser:'postgres',sourceContainer:'old',targetContainer:'new',sourceImageId:digest,targetImage:'ghcr.io/owner/postgres@'+digest,
 databases:['iot_manager','keycloak'],oldBackupPrefix:'s3://approved/old',newBackupPrefix:'s3://approved/new'});
test('migration refuses shared volumes, changed images, unsafe databases and overlapping WAL prefixes',()=>{
 const c=validateMigration(migration()),source={Id:'a',Image:digest,Mounts:[{Destination:'/var/lib/postgresql/data',Source:'/old',Type:'volume'}],State:{Running:true}};
 const target={Id:'b',Config:{Image:c.targetImage},Mounts:[{Destination:'/var/lib/postgresql/data',Source:'/new',Type:'volume'}],State:{Running:true}};
 assertTopology(c,source,target);
 assert.throws(()=>assertTopology(c,source,{...target,Mounts:source.Mounts}));
 assert.throws(()=>assertTopology(c,{...source,Image:'changed'},target));
 for(const update of [{targetContainer:'old'},{newBackupPrefix:c.oldBackupPrefix},{newBackupPrefix:c.oldBackupPrefix+'/nested'},{databases:['postgres']},{databases:['iot_manager; DROP DATABASE x']}])assert.throws(()=>validateMigration({...c,...update}));
 assert.throws(()=>sameInventory({roles:['owner'],data:'before'},{roles:['owner'],data:'after'}));
});
test('reviewed-source executable rejects branch bypass and unmerged workflow or source',()=>{
 const root=mkdtempSync(join(tmpdir(),'iot-source-policy-')),git=(...args)=>{
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try {
  git('init','-b','main');git('config','user.email','lab@example.invalid');git('config','user.name','Lab');
  writeFileSync(join(root,'reviewed'),'ok');git('add','.');git('commit','-m','reviewed');const reviewed=git('rev-parse','HEAD');
  git('update-ref','refs/remotes/origin/main',reviewed);writeFileSync(join(root,'unreviewed'),'pending');git('add','.');git('commit','-m','pending');const pending=git('rev-parse','HEAD');
  const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash',script=resolve(import.meta.dirname,'../assert-reviewed-source.sh').replaceAll('\\','/');
  for(const [ref,source,workflow,allowed,expected] of [
   ['refs/heads/main',reviewed,reviewed,'false',0],['refs/heads/codex/bypass',reviewed,reviewed,'true',64],
   ['refs/heads/main',pending,reviewed,'false',1],['refs/heads/main',reviewed,pending,'false',1],
   ['refs/tags/r1-rc.lab',reviewed,reviewed,'true',0],['refs/tags/r1-rc.lab',reviewed,reviewed,'false',1]]){
    const r=spawnSync(bash,[script],{cwd:root,windowsHide:true,encoding:'utf8',env:{...process.env,DEFAULT_BRANCH:'main',GITHUB_REF:ref,GITHUB_SHA:source,SOURCE_SHA:source,GITHUB_WORKFLOW_SHA:workflow,ALLOW_RELEASE_TAG:allowed}});
    assert.equal(r.status,expected,r.stderr);
   }
 }finally{assert.ok(root.startsWith(tmpdir()+sep+'iot-source-policy-'));rmSync(root,{recursive:true});}
});
test('every dedicated-host job waits for hosted reviewed-source policy',()=>{
 for(const [file,jobs] of [['recovery-drill',['physical-recovery','immutable-physical-recovery']],['rollback-drill',['n-to-n-minus-one']]]){
  const workflow=readFileSync(resolve(import.meta.dirname,'../../../.github/workflows/'+file+'.yml'),'utf8');
  assert.match(workflow,/source-policy:\s+uses: \.\/\.github\/workflows\/release-source-policy.yml/);
  for(const job of jobs)assert.match(workflow,new RegExp('  '+job+':[\\s\\S]*?needs: \\[source-policy\\]'));
 }
});
