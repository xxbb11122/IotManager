import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Linux/Docker laboratory only. Uses the actual R1 private-UI configuration;
// all alerts are synthetic and no external notification receiver is added.
assert.equal(process.platform,'linux','Run this isolated container test on Linux');
const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1];
assert.ok(args.includes('--image')&&args.includes('--output'));
const image=get('--image');assert.match(image,/^ghcr\.io\/[\w./:-]+@sha256:[a-f0-9]{64}$/);
const output=resolve(get('--output'));mkdirSync(output,{recursive:true});
const repository=resolve(import.meta.dirname,'../..'),config=resolve(repository,'deploy/observability/alertmanager.yml');
const source=readFileSync(config,'utf8');assert.doesNotMatch(source,/webhook_configs|email_configs|slack_configs/);
const ownership=randomUUID(),name='iot-alert-sim-'+ownership;
const docker=(...argv)=>execFileSync('docker',argv,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const base='http://127.0.0.1:19096',results=[];
let created=false,passed=false,error=null,cleanupPassed=false;
const record=(name,details={})=>{results.push({name,passed:true,...details});console.log('PASS '+name);};
async function request(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}
 return {status:response.status,value};
}
async function until(probe,label){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){try{const value=await probe();if(value)return value;}catch{}await delay(250);}
 throw Error('Timed out: '+label);
}
try{
 assert.equal(docker('ps','-aq','--filter','name=^/'+name+'$'),'');
 docker('run','-d','--name',name,'--label','iot.simulation.owner='+ownership,'--network','host',
   '--read-only','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges:true',
   '--tmpfs','/alertmanager:uid=65534,gid=65534,mode=0700','-v',config+':/etc/alertmanager/alertmanager.yml:ro',
   image,'--config.file=/etc/alertmanager/alertmanager.yml','--storage.path=/alertmanager',
   '--web.listen-address=127.0.0.1:19096','--cluster.listen-address=');
 created=true;
 await until(async()=>(await request('/-/ready')).status===200,'Alertmanager readiness');
 const status=await request('/api/v2/status');assert.equal(status.status,200);
 assert.match(status.value.config.original,/r1-ops-review/);
 assert.doesNotMatch(status.value.config.original,/webhook_configs|email_configs|slack_configs/);
 record('actual candidate loads the unchanged internal-review configuration',{version:status.value.versionInfo.version});
 const alertname='IsolatedR1Simulation',labels={alertname,service:'simulation-only',severity:'critical'};
 const started=new Date(Date.now()-60000).toISOString();
 const alert={labels,annotations:{summary:'Disposable test alert'},startsAt:started,endsAt:new Date(Date.now()+300000).toISOString(),generatorURL:base};
 assert.equal((await request('/api/v2/alerts',[alert])).status,200);
 const rows=async()=>{const r=await request('/api/v2/alerts');assert.equal(r.status,200);return r.value.filter(row=>row.labels.alertname===alertname);};
 await until(async()=>(await rows()).find(row=>row.status.state==='active'),'firing alert');
 record('firing alert is visible to the internal UI API');
 const silence=await request('/api/v2/silences',{matchers:[{name:'alertname',value:alertname,isRegex:false,isEqual:true}],
   startsAt:started,endsAt:new Date(Date.now()+300000).toISOString(),createdBy:'isolated-test',comment:'Simulation only'});
 assert.equal(silence.status,200);assert.ok(silence.value.silenceID);
 await until(async()=>(await rows()).find(row=>row.status.silencedBy.includes(silence.value.silenceID)),'silenced alert');
 record('silence suppresses the matching synthetic alert');
 assert.equal((await request('/api/v2/silence/'+silence.value.silenceID,undefined,'DELETE')).status,200);
 await until(async()=>(await rows()).find(row=>row.status.state==='active'&&row.status.silencedBy.length===0),'expired silence');
 record('expiring the silence restores active visibility');
 assert.equal((await request('/api/v2/alerts',[{...alert,endsAt:new Date(Date.now()-1000).toISOString()}])).status,200);
 await until(async()=>{const values=await rows();return values.length===0||values.every(row=>Date.parse(row.endsAt)<Date.now());},'resolved alert');
 record('resolved state is reflected by the internal UI API');
 const malformed=await request('/api/v2/alerts',[{labels:{alertname:'InvalidSimulation'},startsAt:'not-a-date'}]);
 assert.equal(malformed.status,400);record('malformed alert timestamps are rejected');
 passed=true;
}catch(cause){error=String(cause.stack);throw cause;}
finally{
 if(created){
   writeFileSync(resolve(output,'alertmanager.log'),docker('logs',name)+'\n');
   assert.equal(docker('inspect','--format','{{index .Config.Labels "iot.simulation.owner"}}',name),ownership);
   docker('rm','-f',name);cleanupPassed=docker('ps','-aq','--filter','name=^/'+name+'$')==='';
 }
 writeFileSync(resolve(output,'summary.json'),JSON.stringify({passed:passed&&cleanupPassed,error,productionApproved:false,
   driverSha:process.env.GITHUB_SHA??null,image,configurationSha256:createHash('sha256').update(source).digest('hex'),
   results,cleanupPassed,externalNotifications:0,
   boundaries:['Actual immutable Alertmanager image with synthetic events and original R1 configuration',
     'Internal UI API acceptance; no real on-call acknowledgement, production routing or operational sign-off']},null,2)+'\n');
}
