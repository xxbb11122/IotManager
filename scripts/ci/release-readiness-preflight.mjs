import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const releaseEnvironments = ['r1-recovery-drill', 'r1-rollback-drill', 'android-release'];
const requiredChecks = ['quick-gate'];

/** Read-only governance checks; this deliberately cannot approve a release. */
export function evaluatePreflight(snapshot) {
  const controls = [];
  const add = (id, readable, passed, detail) => controls.push({ id, status: !readable ? 'UNKNOWN' : passed ? 'PASS' : 'FAIL', detail });
  const classic = snapshot.protection?.ok ? snapshot.protection.body : null;
  const rules = snapshot.rules?.ok && Array.isArray(snapshot.rules.body) ? snapshot.rules.body : [];
  const rule = name => rules.find(value => value.type === name);
  const relevantIds = [...new Set(rules.map(value => value.ruleset_id).filter(Boolean))];
  const rulesetsKnown = relevantIds.length > 0 && relevantIds.every(id => snapshot.rulesets?.[id]?.ok);
  const noBypass = rulesetsKnown && relevantIds.every(id => snapshot.rulesets[id].body.enforcement === 'active' &&
    Array.isArray(snapshot.rulesets[id].body.bypass_actors) && snapshot.rulesets[id].body.bypass_actors.length === 0);
  const statusRule = rule('required_status_checks')?.parameters;
  const contexts = classic?.required_status_checks?.checks?.map(value => value.context) ?? classic?.required_status_checks?.contexts ?? [];
  const ruleContexts = statusRule?.required_status_checks?.map(value => value.context) ?? [];
  const protectedBranch = Boolean(classic || rule('required_status_checks'));
  add('default-branch-protection', Boolean(snapshot.repository?.ok && (snapshot.protection?.ok || snapshot.rules?.ok)), protectedBranch,
    'The default branch must have readable, effective protection.');
  const readable = Boolean(classic || snapshot.rules?.ok);
  add('required-quick-gate', readable,
    (classic?.required_status_checks?.strict === true && requiredChecks.every(value => contexts.includes(value))) ||
    (statusRule?.strict_required_status_checks_policy === true && requiredChecks.every(value => ruleContexts.includes(value))),
    'quick-gate must be required against the current base branch.');
  add('admin-and-history-protection', readable && (Boolean(classic) || rulesetsKnown),
    (classic?.enforce_admins?.enabled === true && classic?.allow_force_pushes?.enabled === false && classic?.allow_deletions?.enabled === false) ||
    (noBypass && Boolean(rule('non_fast_forward')) && Boolean(rule('deletion'))),
    'Administrators cannot bypass protection; force pushes and branch deletion are blocked.');
  const reviews = classic?.required_pull_request_reviews;
  const pullRequest = rule('pull_request')?.parameters;
  add('reviewed-default-branch', readable,
    (Number(reviews?.required_approving_review_count) >= 1 && reviews?.dismiss_stale_reviews === true) ||
    (Number(pullRequest?.required_approving_review_count) >= 1 && pullRequest?.dismiss_stale_reviews_on_push === true && noBypass),
    'At least one approval is required and stale approvals are dismissed.');
  for (const name of releaseEnvironments) {
    const response = snapshot.environments?.[name], environment = response?.body;
    const review = environment?.protection_rules?.find(value => value.type === 'required_reviewers');
    add(`environment:${name}`, Boolean(response?.ok),
      review?.prevent_self_review === true && review?.reviewers?.length > 0 && environment?.can_admins_bypass === false &&
      environment?.deployment_branch_policy?.protected_branches === true,
      'Protected branches only; independent reviewer required, with no administrator bypass.');
  }
  const runnerResponse = snapshot.runners;
  const runners = runnerResponse?.body?.runners;
  add('recovery-runner', Boolean(runnerResponse?.ok && Array.isArray(runners)), Array.isArray(runners) && runners.some(value =>
    value.status === 'online' && ['self-hosted','linux','iot-manager-recovery'].every(label =>
      value.labels?.some(item => item.name?.toLowerCase() === label))), 'An online dedicated recovery runner with all required labels is required.');
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), repository: snapshot.repository?.body?.full_name ?? null,
    defaultBranch: snapshot.repository?.body?.default_branch ?? null, status: controls.every(value=>value.status==='PASS') ? 'PASS' : 'FAIL',
    productionApproved: false, scope: 'repository-governance-only', controls };
}

export function collectSnapshot(repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Use --repository owner/repository');
  const api = path => {
    try { return { ok:true, body:JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true})) }; }
    catch { return { ok:false, error:'GitHub API unavailable or not permitted' }; }
  };
  const repo = api(`repos/${repository}`);
  const branch = repo.ok ? encodeURIComponent(repo.body.default_branch) : null;
  const rules = branch ? api(`repos/${repository}/rules/branches/${branch}`) : {ok:false};
  const rulesets = {};
  if (rules.ok && Array.isArray(rules.body)) {
    for (const id of new Set(rules.body.map(value=>value.ruleset_id).filter(Boolean))) rulesets[id] = api(`repos/${repository}/rulesets/${id}`);
  }
  const runnerPages = [];
  let runners;
  for (let page=1; page<=100; page++) {
    const response=api(`repos/${repository}/actions/runners?per_page=100&page=${page}`);
    if (!response.ok || !Array.isArray(response.body.runners)) { runners={ok:false}; break; }
    runnerPages.push(...response.body.runners);
    if (runnerPages.length >= response.body.total_count) { runners={ok:true,body:{runners:runnerPages}}; break; }
  }
  return {repository:repo,protection:branch ? api(`repos/${repository}/branches/${branch}/protection`) : {ok:false}, rules,rulesets,
    environments:Object.fromEntries(releaseEnvironments.map(name=>[name,api(`repos/${repository}/environments/${name}`)])),runners:runners??{ok:false}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2), get=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
  const repository=get('--repository'), output=get('--output');
  const report=evaluatePreflight(collectSnapshot(repository??''));
  if (output) {mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.status==='PASS'?0:1;
}
