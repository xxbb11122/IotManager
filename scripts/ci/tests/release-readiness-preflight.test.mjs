import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePreflight, releaseEnvironments } from '../release-readiness-preflight.mjs';
const ok=body=>({ok:true,body});
function valid() {
  return {repository:ok({full_name:'example/project',default_branch:'main'}),
    protection:ok({required_status_checks:{strict:true,checks:[{context:'quick-gate'}]},enforce_admins:{enabled:true},
      allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true}}),
    rules:ok([]),environments:Object.fromEntries(releaseEnvironments.map(name=>[name,ok({can_admins_bypass:false,
      deployment_branch_policy:{protected_branches:true},protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'User',reviewer:{id:1}}]}]})])),
    runners:ok({runners:[{status:'online',labels:['self-hosted','Linux','iot-manager-recovery'].map(name=>({name}))}]})};
}
test('full governance passes without claiming production approval',()=>{
  const result=evaluatePreflight(valid()); assert.equal(result.status,'PASS');assert.equal(result.productionApproved,false);assert.equal(result.controls.length,8);
});
test('each missing control fails closed',()=>{
  for(const mutate of [s=>s.protection.body.required_status_checks.checks=[],s=>s.protection.body.enforce_admins.enabled=false,
    s=>s.protection.body.required_pull_request_reviews.dismiss_stale_reviews=false,s=>s.runners.body.runners[0].status='offline',
    s=>s.runners.body.runners[0].labels.pop(),...releaseEnvironments.map(name=>s=>s.environments[name].body.protection_rules[0].prevent_self_review=false)]){
    const snapshot=valid();mutate(snapshot);assert.equal(evaluatePreflight(snapshot).status,'FAIL');
  }
});
test('API errors are UNKNOWN and cannot become a pass',()=>{
  const snapshot=valid();snapshot.environments['android-release']={ok:false};snapshot.runners={ok:false};
  const result=evaluatePreflight(snapshot);assert.equal(result.status,'FAIL');assert.equal(result.controls.filter(row=>row.status==='UNKNOWN').length,2);
});
test('effective rulesets provide equivalent checks only with proven absence of bypass',()=>{
  const snapshot=valid();snapshot.protection={ok:false};snapshot.rulesets={7:ok({enforcement:'active',bypass_actors:[]})};
  snapshot.rules=ok([
    {type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:'quick-gate'}]}},
    {type:'non_fast_forward'},{type:'deletion'},
    {type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true}}
  ].map(value=>({...value,ruleset_id:7})));
  assert.equal(evaluatePreflight(snapshot).status,'PASS');
  snapshot.rulesets[7].body.bypass_actors=[{actor_type:'RepositoryRole',actor_id:5}];
  assert.equal(evaluatePreflight(snapshot).status,'FAIL');
});
test('an unprotected branch and unreviewed environments are never accepted',()=>{
  const snapshot=valid();snapshot.protection={ok:false};snapshot.rules=ok([]);
  assert.equal(evaluatePreflight(snapshot).status,'FAIL');
  const empty=valid();empty.environments['android-release'].body.protection_rules=[];assert.equal(evaluatePreflight(empty).status,'FAIL');
});
