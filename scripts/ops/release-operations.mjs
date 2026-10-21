import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {args, main, run, gh, report, fail, repository} from './common.mjs';
import {collectSnapshot, evaluatePreflight} from '../ci/release-readiness-preflight.mjs';

export function validateConfig(config) {
  repository(config.repository);
  assert.match(config.sourceSha??'',/^[a-f0-9]{40}$/,'Use the reviewed full main-branch SHA');
  assert.match(config.sourceProject??'',/^[a-z0-9][a-z0-9_-]{0,62}$/);
  assert.ok(['client','glass'].includes(config.app));
  assert.ok(Number.isInteger(config.versionCode)&&config.versionCode>0&&config.versionCode<=2100000000);
  assert.match(config.versionName??'',/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/);
  for(const key of ['currentEvidenceDigest','rollbackEvidenceDigest'])if(config[key])assert.match(config[key],/^sha256:[a-f0-9]{64}$/);
  if(config.currentEvidenceDigest&&config.rollbackEvidenceDigest)assert.notEqual(config.currentEvidenceDigest,config.rollbackEvidenceDigest,'N and N-1 must be distinct');
  return config;
}
export function buildPlan(config, snapshot, head, metadata) {
  validateConfig(config);
  const governance=evaluatePreflight(snapshot), controls=[...governance.controls];
  controls.push({id:'reviewed-source',status:head===config.sourceSha?'PASS':'FAIL',detail:'Candidate must equal the current protected default-branch head.'});
  const prefix=`IOT_${config.app.toUpperCase()}_RELEASE_`;
  const secrets=['KEYSTORE_BASE64','STORE_PASSWORD','KEY_ALIAS','KEY_PASSWORD'].map(name=>prefix+name);
  const vars=[`ANDROID_${config.app.toUpperCase()}_CERT_SHA256`,`ANDROID_${config.app.toUpperCase()}_LAST_RELEASE_VERSION_CODE`];
  const signingReady=secrets.every(name=>metadata?.secrets?.includes(name)) && /^[a-fA-F0-9]{64}$/.test(metadata?.variables?.[vars[0]]??'') &&
    /^(0|[1-9][0-9]*)$/.test(metadata?.variables?.[vars[1]]??'') && config.versionCode>Number(metadata.variables[vars[1]]);
  const common=controls.every(c=>c.status==='PASS');
  const request=(workflow,inputs,ready)=>({workflow,ref:snapshot.repository?.body?.default_branch,inputs,ready:Boolean(ready)});
  return {schemaVersion:1,scope:'release-operation-plan',productionApproved:false,sourceSha:config.sourceSha,repository:config.repository,controls,
    signingConfiguration:signingReady?'PRESENT':'MISSING_OR_VERSION_REUSED',
    stages:{gate:request('release-gate.yml',{source_sha:config.sourceSha,source_project:config.sourceProject},common),
      recovery:request('recovery-drill.yml',{source_project:config.sourceProject},common),
      android:request('android-release.yml',{source_sha:config.sourceSha,app:config.app,version_code:String(config.versionCode),version_name:config.versionName},common&&signingReady),
      rollback:request('rollback-drill.yml',{current_evidence_digest:config.currentEvidenceDigest??'',rollback_evidence_digest:config.rollbackEvidenceDigest??''},
        common&&config.currentEvidenceDigest&&config.rollbackEvidenceDigest)},
    boundaries:['Dispatch creates an approval-gated workflow, not release approval.',
      'N-1 must come from a previously approved and attested Release Integrity Gate.',
      'No automatic merge, tag, traffic switch, or version baseline update.']};
}
export function dispatch(plan, stage, request=(endpoint,{method,body})=>run('gh',['api',endpoint,'--method',method,'--input','-'],{input:JSON.stringify(body)})) {
  const selected=plan.stages[stage]; assert.ok(selected,'Use stage gate, recovery, android or rollback');
  assert.ok(selected.ready,`Stage ${stage} is blocked; inspect plan controls and configuration`);
  request(`repos/${plan.repository}/actions/workflows/${selected.workflow}/dispatches`,{
    method:'POST',body:{ref:selected.ref,inputs:selected.inputs}});
  return {status:'DISPATCHED',productionApproved:false,repository:plan.repository,sourceSha:plan.sourceSha,stage,
    workflow:selected.workflow,dispatchedAt:new Date().toISOString(),conclusion:'PENDING',
    next:'Observe the exact Actions run and retain its signed evidence. A dispatch is not a PASS.'};
}
if(main(import.meta.url))try {
  const {command,options}=args();assert.ok(['plan','dispatch'].includes(command));
  const config=validateConfig(JSON.parse(readFileSync(options.config,'utf8'))), repo=config.repository;
  const snapshot=collectSnapshot(repo), branch=snapshot.repository?.body?.default_branch;
  const head=branch?gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha:null;
  let metadata={};
  try {
    metadata={secrets:gh(`repos/${repo}/environments/android-release/secrets?per_page=100`).secrets.map(item=>item.name),
      variables:Object.fromEntries(gh(`repos/${repo}/environments/android-release/variables?per_page=100`).variables.map(item=>[item.name,item.value]))};
  }catch {/* Unreadable signing metadata stays blocked. */}
  const plan=buildPlan(config,snapshot,head,metadata);
  const send=(endpoint,{method,body})=>run('gh',['api',endpoint,'--method',method,'--input','-'],{input:JSON.stringify(body)});
  report(options.output,command==='plan'?plan:dispatch(plan,options.stage,send));
}catch(error){fail(error);}
