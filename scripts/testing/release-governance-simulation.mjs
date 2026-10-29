import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';

// This standalone process tests production functions with in-memory requests.
// Fail on accidental use of their real transport; this is not an OS sandbox.
const forbiddenAttempts = [];
const forbid = name => () => {
  forbiddenAttempts.push(name);
  throw new Error(`SIMULATION_FORBIDS_EXTERNAL_IO:${name}`);
};
for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
  childProcess[name] = forbid(`child_process.${name}`);
}
for (const [name, module] of [['http', http], ['https', https]]) {
  module.request = forbid(`${name}.request`);
  module.get = forbid(`${name}.get`);
}
net.connect = forbid('net.connect');
net.createConnection = forbid('net.createConnection');
net.Socket.prototype.connect = forbid('net.Socket.connect');
dgram.createSocket = forbid('dgram.createSocket');
globalThis.fetch = forbid('fetch');
syncBuiltinESMExports();

const {evaluatePreflight} = await import('../ci/release-readiness-preflight.mjs');
const {buildPlan, dispatch} = await import('../ops/release-operations.mjs');

const sourceSha = 'a'.repeat(40);
const currentDigest = `sha256:${'b'.repeat(64)}`;
const previousDigest = `sha256:${'c'.repeat(64)}`;
const environments = ['r1-recovery-drill', 'r1-rollback-drill', 'android-release'];
const stages = ['gate', 'recovery', 'android', 'rollback'];
const allReady = Object.fromEntries(stages.map(stage => [stage, true]));
const allBlocked = Object.fromEntries(stages.map(stage => [stage, false]));
const workflows = {gate:'release-gate.yml', recovery:'recovery-drill.yml', android:'android-release.yml', rollback:'rollback-drill.yml'};
const secretSuffixes = ['KEYSTORE_BASE64', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'];
const ok = body => ({ok:true, body});

function fixture(app = 'glass') {
  return {
    config:{repository:'simulation-only/fixture', sourceSha, sourceProject:'synthetic-source', app,
      versionCode:26, versionName:'1.2.0-simulation', currentEvidenceDigest:currentDigest, rollbackEvidenceDigest:previousDigest},
    head:sourceSha,
    snapshot:{repository:ok({full_name:'simulation-only/fixture', default_branch:'main'}),
      protection:ok({required_status_checks:{strict:true, checks:[{context:'quick-gate', app_id:15368}]},
        enforce_admins:{enabled:true}, allow_force_pushes:{enabled:false}, allow_deletions:{enabled:false},
        required_pull_request_reviews:{required_approving_review_count:1, dismiss_stale_reviews:true, require_last_push_approval:true}}),
      rules:ok([]),
      environments:Object.fromEntries(environments.map(name => [name, ok({name, can_admins_bypass:false,
        deployment_branch_policy:{protected_branches:true, custom_branch_policies:false},
        protection_rules:[{type:'required_reviewers', prevent_self_review:true, reviewers:[{type:'User', reviewer:{id:42, login:'synthetic-reviewer'}}]}]})])),
      runners:ok({runners:[{id:1, status:'online', labels:['self-hosted','Linux','iot-manager-recovery'].map(name => ({name}))}]})},
    metadata:{secrets:secretSuffixes.map(name => `IOT_${app.toUpperCase()}_RELEASE_${name}`),
      variables:{[`ANDROID_${app.toUpperCase()}_CERT_SHA256`]:'d'.repeat(64), [`ANDROID_${app.toUpperCase()}_LAST_RELEASE_VERSION_CODE`]:'25'}}
  };
}

function rulesetFixture(f) {
  // Exercise the ruleset-only path, without the classic protection fallback.
  f.snapshot.protection = {ok:false};
  f.snapshot.rulesets = {7:ok({enforcement:'active', bypass_actors:[]})};
  f.snapshot.rules = ok([
    {type:'required_status_checks', parameters:{strict_required_status_checks_policy:true, required_status_checks:[{context:'quick-gate'}]}},
    {type:'non_fast_forward'}, {type:'deletion'},
    {type:'pull_request', parameters:{required_approving_review_count:1, dismiss_stale_reviews_on_push:true}}
  ].map(rule => ({...rule, ruleset_id:7})));
}

const cases = [];
function add(id, description, mutate = () => {}, options = {}) {
  cases.push({id, description, mutate, expected:{ready:allReady, governance:'PASS', controls:{}, ...options}});
}
function block(id, description, control, mutate, status = 'FAIL') {
  add(id, description, mutate, {ready:allBlocked, governance:'FAIL', controls:{[control]:status}});
}
for (const app of ['client','glass']) add(`valid-${app}`, `${app}: valid synthetic metadata permits pending requests`, () => {}, {app});

for (const name of environments) {
  const control = `environment:${name}`;
  block(`${name}-missing`, `${name}: missing environment`, control, f => {delete f.snapshot.environments[name];}, 'UNKNOWN');
  block(`${name}-unreadable`, `${name}: API unavailable`, control, f => {f.snapshot.environments[name]={ok:false};}, 'UNKNOWN');
  const env = f => f.snapshot.environments[name].body;
  block(`${name}-no-review-rule`, `${name}: approval rule missing`, control, f => {env(f).protection_rules=[];});
  block(`${name}-no-reviewer`, `${name}: reviewer list empty`, control, f => {env(f).protection_rules[0].reviewers=[];});
  block(`${name}-self-review`, `${name}: self-review allowed`, control, f => {env(f).protection_rules[0].prevent_self_review=false;});
  block(`${name}-admin-bypass`, `${name}: administrator bypass allowed`, control, f => {env(f).can_admins_bypass=true;});
  block(`${name}-unrestricted-branches`, `${name}: deployment branch policy missing`, control, f => {env(f).deployment_branch_policy=null;});
}
const classic = f => f.snapshot.protection.body;
block('unprotected-branch', 'No effective default branch protection', 'default-branch-protection', f => {f.snapshot.protection={ok:false};});
block('missing-quick-gate', 'Required quick-gate missing', 'required-quick-gate', f => {classic(f).required_status_checks.checks=[];});
block('non-strict-checks', 'Checks not required against current base', 'required-quick-gate', f => {classic(f).required_status_checks.strict=false;});
block('branch-admin-bypass', 'Branch administrator enforcement disabled', 'admin-and-history-protection', f => {classic(f).enforce_admins.enabled=false;});
block('force-push-allowed', 'Force push permitted', 'admin-and-history-protection', f => {classic(f).allow_force_pushes.enabled=true;});
block('deletion-allowed', 'Branch deletion permitted', 'admin-and-history-protection', f => {classic(f).allow_deletions.enabled=true;});
block('no-pr-approval', 'No pull request approval required', 'reviewed-default-branch', f => {classic(f).required_pull_request_reviews.required_approving_review_count=0;});
block('stale-review', 'Stale approval not dismissed', 'reviewed-default-branch', f => {classic(f).required_pull_request_reviews.dismiss_stale_reviews=false;});
block('repository-unreadable', 'Repository identity unavailable', 'default-branch-protection', f => {f.snapshot.repository={ok:false};}, 'UNKNOWN');

add('valid-ruleset', 'Equivalent ruleset-only protections', rulesetFixture);
block('ruleset-bypass', 'Ruleset has bypass actor', 'admin-and-history-protection', f => {
  rulesetFixture(f); f.snapshot.rulesets[7].body.bypass_actors=[{actor_type:'RepositoryRole', actor_id:5}];
});
block('ruleset-unreadable', 'Ruleset details unavailable', 'admin-and-history-protection', f => {
  rulesetFixture(f); f.snapshot.rulesets[7]={ok:false};
}, 'UNKNOWN');
block('ruleset-inactive', 'Ruleset is not active', 'admin-and-history-protection', f => {
  rulesetFixture(f); f.snapshot.rulesets[7].body.enforcement='evaluate';
});
block('ruleset-no-deletion-rule', 'Ruleset deletion protection missing', 'admin-and-history-protection', f => {
  rulesetFixture(f); f.snapshot.rules.body=f.snapshot.rules.body.filter(rule => rule.type!=='deletion');
});

block('runner-empty', 'No registered runner', 'recovery-runner', f => {f.snapshot.runners.body.runners=[];});
block('runner-offline', 'Runner offline', 'recovery-runner', f => {f.snapshot.runners.body.runners[0].status='offline';});
block('runner-unreadable', 'Runner API unavailable', 'recovery-runner', f => {f.snapshot.runners={ok:false};}, 'UNKNOWN');
for (const label of ['self-hosted','linux','iot-manager-recovery']) {
  block(`runner-missing-${label}`, `Runner missing ${label} label`, 'recovery-runner', f => {
    f.snapshot.runners.body.runners[0].labels=f.snapshot.runners.body.runners[0].labels.filter(v => v.name.toLowerCase()!==label);
  });
}
block('runner-split-labels', 'Required labels spread across separate runners', 'recovery-runner', f => {
  f.snapshot.runners.body.runners=['self-hosted','linux','iot-manager-recovery'].map(name => ({status:'online',labels:[{name}]}));
});
add('runner-one-qualified', 'One qualified runner among unsuitable runners', f => {
  f.snapshot.runners.body.runners.unshift({status:'offline',labels:[]}, {status:'online',labels:[{name:'windows'}]});
});
for (const [id, head] of [['source-moved', 'f'.repeat(40)], ['source-unreadable', null]]) {
  add(id, 'Candidate does not match current default branch HEAD', f => {f.head=head;},
    {ready:allBlocked, controls:{'reviewed-source':'FAIL'}});
}
add('source-not-sha', 'Branch name cannot replace complete source SHA', f => {f.config.sourceSha='main';}, {reject:/reviewed full main-branch SHA/});

for (const app of ['client','glass']) {
  const androidBlocked = {app, ready:{...allReady, android:false}, signing:'MISSING_OR_VERSION_REUSED'};
  const baseline = `ANDROID_${app.toUpperCase()}_LAST_RELEASE_VERSION_CODE`;
  for (const suffix of secretSuffixes) add(`${app}-missing-${suffix.toLowerCase()}`, `${app}: missing signing Secret name ${suffix}`, f => {
    f.metadata.secrets=f.metadata.secrets.filter(name => name!==`IOT_${app.toUpperCase()}_RELEASE_${suffix}`);
  }, androidBlocked);
  add(`${app}-other-app-secrets`, `${app}: other App credentials cannot satisfy signing configuration`, f => {
    f.metadata.secrets=fixture(app==='client'?'glass':'client').metadata.secrets;
  }, androidBlocked);
  add(`${app}-bad-fingerprint`, `${app}: invalid certificate fingerprint metadata`, f => {
    f.metadata.variables[`ANDROID_${app.toUpperCase()}_CERT_SHA256`]='not-a-fingerprint';
  }, androidBlocked);
  for (const [id, value] of [['version-reused','26'], ['version-lower','27'], ['bad-baseline','NaN'], ['missing-baseline',undefined]]) {
    add(`${app}-${id}`, `${app}: version must increase above a valid baseline`, f => {f.metadata.variables[baseline]=value;}, androidBlocked);
  }
}
for (const key of ['currentEvidenceDigest','rollbackEvidenceDigest']) {
  add(`missing-${key}`, 'Both N and N-1 digests required for rollback', f => {delete f.config[key];}, {ready:{...allReady,rollback:false}});
  add(`invalid-${key}`, 'Malformed digest rejected before dispatch', f => {f.config[key]='not-a-digest';}, {reject:/sha256:/});
}
add('equal-evidence', 'N and N-1 cannot have the same digest', f => {f.config.rollbackEvidenceDigest=currentDigest;}, {reject:/N and N-1 must be distinct/});
for (const stage of stages) add(`request-failure-${stage}`, 'Request transport error must propagate without a successful result', () => {}, {requestFailure:stage});
add('invalid-stage', 'Unknown workflow stage cannot issue a request', () => {}, {invalidStage:true});
add('historical-gap-replay', 'Synthetic replay of 2026-10-27 governance gaps; not a live snapshot', f => {
  f.snapshot.environments['r1-recovery-drill']=ok({can_admins_bypass:true, protection_rules:[], deployment_branch_policy:null});
  f.snapshot.environments['r1-rollback-drill']={ok:false};
  f.snapshot.environments['android-release']={ok:false};
  f.snapshot.runners.body.runners=[];
}, {ready:allBlocked, governance:'FAIL', counts:{PASS:4, FAIL:2, UNKNOWN:2}, controls:{
  'environment:r1-recovery-drill':'FAIL', 'environment:r1-rollback-drill':'UNKNOWN', 'environment:android-release':'UNKNOWN', 'recovery-runner':'FAIL'}});

// Independent request oracle: never derive expected requests from plan output.
function expectedRequest(stage, config) {
  const inputs = {
    gate:{source_sha:config.sourceSha, source_project:config.sourceProject},
    recovery:{source_project:config.sourceProject},
    android:{source_sha:config.sourceSha, app:config.app, version_code:String(config.versionCode), version_name:config.versionName},
    rollback:{current_evidence_digest:config.currentEvidenceDigest, rollback_evidence_digest:config.rollbackEvidenceDigest}
  };
  return {endpoint:`repos/simulation-only/fixture/actions/workflows/${workflows[stage]}/dispatches`,
    request:{method:'POST', body:{ref:'main', inputs:inputs[stage]}}};
}

function executeCase(scenario) {
  const f=fixture(scenario.expected.app), expected=scenario.expected;
  const observed={stages:{}, requests:[]}, ioStart=forbiddenAttempts.length;
  const result={id:scenario.id, description:scenario.description, simulation:true, productionApproved:false,
    expected:{...expected, reject:expected.reject?.source}, observed};
  try {
    scenario.mutate(f);
    const oracleConfig=structuredClone(f.config);
    const governance=evaluatePreflight(f.snapshot);
    observed.governance=governance.status;
    observed.controls=Object.fromEntries(governance.controls.map(control => [control.id,control.status]));
    assert.equal(governance.productionApproved,false);
    assert.equal(governance.status,expected.governance);
    if (expected.counts) assert.deepEqual(Object.fromEntries(['PASS','FAIL','UNKNOWN'].map(status =>
      [status,governance.controls.filter(control => control.status===status).length])),expected.counts);
    if (expected.reject) {
      assert.throws(() => buildPlan(f.config,f.snapshot,f.head,f.metadata),expected.reject);
      observed.outcome='PLAN_REJECTED';
    } else {
      const plan=buildPlan(f.config,f.snapshot,f.head,f.metadata);
      assert.equal(plan.productionApproved,false);
      observed.controls=Object.fromEntries(plan.controls.map(control => [control.id,control.status]));
      observed.signingConfiguration=plan.signingConfiguration;
      for (const [id,status] of Object.entries(expected.controls)) assert.equal(observed.controls[id],status,`${id} status`);
      assert.equal(plan.signingConfiguration,expected.signing??'PRESENT');
      for (const stage of stages) {
        const requests=[];
        const request=(endpoint,payload) => {
          const record={endpoint,request:structuredClone(payload)};
          requests.push(record); observed.requests.push({stage,...record});
          if (expected.requestFailure===stage) throw new Error('SYNTHETIC_REQUEST_REJECTED');
        };
        observed.stages[stage]={ready:plan.stages[stage].ready};
        assert.equal(plan.stages[stage].ready,expected.ready[stage],`${stage} readiness`);
        if (!expected.ready[stage]) {
          assert.throws(() => dispatch(plan,stage,request),new RegExp(`Stage ${stage} is blocked`));
          assert.equal(requests.length,0,`${stage} must not send any request`);
          observed.stages[stage].outcome='BLOCKED_NO_REQUEST';
        } else if (expected.requestFailure===stage) {
          assert.throws(() => dispatch(plan,stage,request),/SYNTHETIC_REQUEST_REJECTED/);
          assert.deepEqual(requests,[expectedRequest(stage,oracleConfig)]);
          observed.stages[stage].outcome='SIMULATED_REQUEST_REJECTED';
        } else {
          const receipt=dispatch(plan,stage,request);
          assert.deepEqual(requests,[expectedRequest(stage,oracleConfig)]);
          assert.equal(receipt.status,'DISPATCHED'); assert.equal(receipt.conclusion,'PENDING');
          assert.equal(receipt.productionApproved,false);
          assert.equal(receipt.sourceSha,oracleConfig.sourceSha); assert.equal(receipt.stage,stage);
          assert.equal(receipt.workflow,workflows[stage]); assert.equal(receipt.repository,oracleConfig.repository);
          observed.stages[stage].outcome='SIMULATED_REQUEST_PENDING';
        }
        observed.stages[stage].requestCount=requests.length;
      }
      if (expected.invalidStage) {
        let requests=0;
        assert.throws(() => dispatch(plan,'not-a-stage',() => {requests++;}),/Use stage/);
        assert.equal(requests,0);
        observed.invalidStage='BLOCKED_NO_REQUEST';
      }
    }
    assert.equal(forbiddenAttempts.length,ioStart,'Attempted external I/O');
    result.status='PASS';
  } catch (error) {
    result.status='FAIL'; result.assertionError=error.message;
  }
  return result;
}

try {
  const argv=process.argv.slice(2);
  assert.ok(argv.length===2&&argv[0]==='--output'&&argv[1]&&!argv[1].startsWith('--'),
    'Usage: node scripts/testing/release-governance-simulation.mjs --output <local-report.json>');
  assert.equal(new Set(cases.map(c => c.id)).size,cases.length,'Scenario IDs must be unique');
  const results=cases.map(executeCase);
  const sourceFiles=['scripts/testing/release-governance-simulation.mjs','scripts/ci/release-readiness-preflight.mjs',
    'scripts/ops/release-operations.mjs','scripts/ops/common.mjs'];
  const root=resolve(import.meta.dirname,'../..');
  const report={schemaVersion:1, scope:'offline-release-governance-simulation', simulation:true, productionApproved:false,
    checkedAt:new Date().toISOString(), node:process.version, platform:process.platform,
    status:results.every(r => r.status==='PASS')&&forbiddenAttempts.length===0?'PASS':'FAIL',
    total:results.length, passed:results.filter(r => r.status==='PASS').length, failed:results.filter(r => r.status==='FAIL').length, skipped:0,
    forbiddenExternalIoAttempts:forbiddenAttempts,
    sources:sourceFiles.map(file => ({file,sha256:createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')})),
    boundaries:[
      'Synthetic API snapshots and in-memory requests; no GitHub environment was created or approved.',
      'Reviewer presence does not prove an independent eligible reviewer can approve.',
      'Runner status and labels do not prove host isolation, OS, capacity or successful registration.',
      'Signing metadata presence does not prove key validity or signed APK/AAB acceptance.',
      'Distinct digests do not prove artifact existence, attestation validity or a known-good N-1.',
      'Preflight does not check quick-gate App ID or require_last_push_approval.',
      'A simulated dispatch remains pending and is never production approval.',
      'The external I/O guard prevents common accidental transports; it is not an OS sandbox.'
    ], cases:results};
  const output=resolve(argv[1]); mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`SIMULATION ${report.status}: ${report.passed}/${report.total}, failures=${report.failed}, skipped=0, external-I/O-attempts=${forbiddenAttempts.length}, productionApproved=false`);
  for (const result of results.filter(r => r.status==='FAIL')) console.error(`${result.id}: ${result.assertionError}`);
  console.log(`Report: ${output}`);
  process.exitCode=report.status==='PASS'?0:1;
} catch (error) {
  console.error(error.message); process.exitCode=1;
}
