// Supplementary production-build measurements. All transport and history data
// are synthetic and all network traffic is restricted to the local server.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {createHash} from 'node:crypto';

const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('='); return [key,value.join('=')];}));
if (!options.baseline || !options.candidate || !options.out) throw new Error('Use --baseline=ABS --candidate=ABS --out=ABS [--rounds=3] [--samples=30] [--rates=1,4]');
const output=resolve(options.out), rounds=Number(options.rounds || 3), samples=Number(options.samples || 30), rates=(options.rates || '1,4').split(',').map(Number);
const navigationOnly=options['navigation-only']==='true', roundOffset=Number(options['round-offset'] || 0);
if (![rounds,samples,...rates].every(n=>Number.isInteger(n) && n>0)) throw new Error('Invalid measurement options');
await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'), servers=[], builds={};
for (const name of ['baseline','candidate']) {
  const root=resolve(options[name]);
  const server=createServer(async (request,response)=>{
    try {
      const file=resolve(root,'.'+(new URL(request.url,'http://localhost').pathname.replace(/^\/$/,'/index.html')));
      if (!file.startsWith(root+sep)) {response.writeHead(403).end(); return;}
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
      response.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));
    } catch {response.writeHead(404).end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done)); servers.push(server);
  builds[name]={root,origin:'http://127.0.0.1:'+server.address().port,indexSha256:hash(await readFile(resolve(root,'index.html')))};
}
const browser=await chromium.launch();
const report={createdAt:new Date().toISOString(),browser:browser.version(),viewport:{width:390,height:844},rounds,samples,rates,
  warmups:5,mode:navigationOnly?'navigation-retest':'workflows',roundOffset,builds,scriptSha256:hash(await readFile(new URL(import.meta.url))),results:[],failures:[]};
async function mount(name,rate) {
  const origin=builds[name].origin, errors=[], calls=[], fixture={messageCount:100,denyHistory:false,deviceOffline:false};
  const devices=Array.from({length:200},(_,i)=>({id:'fixture-'+i,deviceId:'public-'+i,displayName:'合成设备 '+i,siteCode:'perf-site',online:true,
    connections:[{transport:'LAN_AGENT',status:'CONNECTED',profileId:'fixture-relay'}],
    capabilities:{profileId:'fixture-relay',controls:[{id:'power',label:'电源',valueType:'boolean',stateKey:'on',commandType:'set_power'}]},
    reportedState:{on:false},desiredState:{on:false}}));
  const context=await browser.newContext({viewport:report.viewport,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname;
    if (url.origin!==origin) {errors.push('External request: '+url.origin); await route.abort(); return;}
    if (!path.startsWith('/api/')) return route.continue();
    calls.push({method:request.method(),path,query:url.search});
    const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if (request.method()!=='GET') {errors.push('Unexpected write: '+path); return reply({},405);}
    if (path==='/api/v1/me') return reply({subject:'synthetic-owner',roles:['OWNER'],sites:[{id:1}]});
    if (path==='/api/v1/sites') return reply([{id:1,siteCode:'perf-site',siteName:'模拟装配车间',organizationCode:'perf-org'}]);
    if (path==='/api/v1/devices') return fixture.deviceOffline ? route.abort('failed') : reply(devices);
    if (path.startsWith('/api/v1/devices/')) return reply(path.endsWith('/activity') ? [] : devices[0]);
    if (path.endsWith('/ai/status')) return reply({enabled:true});
    if (path.endsWith('/ai/capabilities')) return reply({contractVersion:1,features:{history:true,pagedMessages:true,idempotency:true,requestRecovery:true,personaActivationGuard:true}});
    if (path.endsWith('/ai/conversations')) return fixture.denyHistory ? reply({message:'模拟权限撤销'},403) : reply({items:[{id:'c1',title:'合成历史',updatedAt:'2026-11-10T08:00:00Z'}],nextCursor:null});
    if (path.endsWith('/ai/conversations/c1')) return reply({personaVersion:0});
    if (path.endsWith('/ai/conversations/c1/messages')) {
      const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit') || 20)));
      const end=Number(url.searchParams.get('cursor') || fixture.messageCount), start=Math.max(0,end-limit);
      return reply({items:Array.from({length:end-start},(_,offset)=>{const i=start+offset;return {id:'m'+i,turnId:'t'+Math.floor(i/2),role:i%2?'ASSISTANT':'USER',content:'合成消息 '+i};}),nextCursor:start?String(start):null});
    }
    if (path.endsWith('/ai/persona')) return reply({version:0,name:'默认性格',instructions:''});
    if (path.endsWith('/ai/persona/versions')) return reply([]);
    if (path.endsWith('/weather-settings')) return reply({latitude:0,longitude:0,timezone:'UTC',locationSource:'MANUAL'});
    if (path.endsWith('/weather/forecast')) return reply({status:'FRESH',hourly:[],daily:[]});
    if (path.endsWith('/weather')) return reply({siteCode:'perf-site',status:'FRESH',current:{temperatureC:24,conditionText:'多云'},indicators:{}});
    errors.push('Unexpected API: '+path); return reply({},404);
  });
  await context.addInitScript(({origin})=>{
    localStorage.setItem('CapacitorStorage.iot-manager.active-endpoint.v1',JSON.stringify({id:'perf-only',accessRoute:'SITE_API',apiBaseUrl:origin+'/api/v1',wsUrl:origin.replace('http:','ws:')+'/ws/devices',organizationCode:'perf-org',accessToken:'synthetic-not-a-real-token'}));
    localStorage.setItem('CapacitorStorage.iot-manager.selected-site.v1',JSON.stringify({siteCode:'perf-site'}));
    window.fixtureSockets=[]; window.fixtureWsErrors=[];
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=async (...args)=>{
      try {const response=await fetchOriginal(...args);if(response.status===403)window.fixtureDeniedAt=performance.now();return response;}
      catch(error) {if(new URL(String(args[0]),location.href).pathname==='/api/v1/devices')window.fixtureOfflineAt=performance.now();throw error;}
    };
    const nowOriginal=Date.now;window.fixtureClockOffset=0;Date.now=()=>nowOriginal()+window.fixtureClockOffset;
    window.WebSocket=class {
      constructor(url) {if (new URL(url).host!==new URL(origin).host) window.fixtureWsErrors.push(String(url));this.readyState=0;window.fixtureSockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.({});},0);}
      send() {} close() {this.readyState=3;this.onclose?.({code:1000});}
      addEventListener(type,listener) {this['on'+type]=listener;}
      removeEventListener(type,listener) {if(this['on'+type]===listener) delete this['on'+type];}
    };
  },{origin});
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate});
  try {
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('[data-device-ref="fixture-0"]').waitFor();
    await page.waitForFunction(()=>!document.getElementById('startup-overlay') && window.fixtureSockets.at(-1)?.readyState===1);
    if (await page.locator('[data-action="open-device"]').count()!==200) throw new Error('Device count mismatch');
    return {page,context,fixture,calls,errors};
  } catch(error) {await context.close();throw error;}
}
async function command(page,status,index) {
  return page.evaluate(async ({status,index})=>{
    const start=performance.now();
    await new Promise((done,reject)=>{
      let timer;
      const check=()=>{if(!document.querySelector('.command-card--'+status.toLowerCase()))return;clearTimeout(timer);observer.disconnect();done();};
      const observer=new MutationObserver(check);observer.observe(document.getElementById('app'),{childList:true,subtree:true,attributes:true});
      timer=setTimeout(()=>{observer.disconnect();reject(new Error('Command state not visible: '+status));},30000);
      window.fixtureSockets.at(-1).onmessage({data:JSON.stringify({version:1,timestamp:Date.now(),type:'command_update',payload:{commandId:'fixture-command',deviceId:'fixture-0',type:'set_power',status,
        parameters:{on:true},reportedState:{on:status==='ACKNOWLEDGED'},createdAt:new Date(Date.now()+index).toISOString(),failureReason:'合成执行失败'}})});
      check();
    });
    const dom=performance.now()-start;
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    return {dom,paintOpportunity:performance.now()-start};
  },{status,index});
}
async function input(page) {
  return page.locator('#ai-question').evaluate(async (field,samples)=>{
    field.focus();const scroll=document.querySelector('[data-region="ai-scroll"]');scroll.scrollTop=100;
    const top=scroll.scrollTop,first=document.querySelector('.ai-message'),original=document.createElement;
    let created=0;document.createElement=function(...args){created++;return original.apply(this,args);};
    const dispatch=value=>{field.value=value;field.setSelectionRange(value.length,value.length);field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));};
    const rows=[];
    try {
      for(let i=0;i<5;i++) dispatch('预热'+i);
      created=0;
      for(let i=0;i<samples;i++) {const start=performance.now();dispatch('合成草稿'+i);const dom=performance.now()-start;
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));rows.push({dom,paintOpportunity:performance.now()-start});}
      return {samples:rows,created,sameField:field===document.getElementById('ai-question'),sameMessage:first===document.querySelector('.ai-message'),
        selection:field.selectionStart,value:field.value,scrollBefore:top,scrollAfter:scroll.scrollTop,messages:document.querySelectorAll('.ai-message').length};
    } finally {document.createElement=original;}
  },samples);
}
async function measureSafety(page,kind) {
  await page.evaluate(kind=>{
    const field=kind==='permission'?'fixtureDeniedAt':'fixtureOfflineAt';
    window[field]=null;window.fixtureSafetyResult=null;
    const ready=()=>kind==='permission'
      ? !document.querySelector('.ai-history-item') && Boolean(document.querySelector('.ai-notice--error'))
      : document.querySelector('[data-region="device-controls"]')?.textContent.includes('缓存状态')
        && !document.querySelector('[data-region="device-controls"] .switch-button:not(:disabled)');
    const observer=new MutationObserver(()=>{
      if(window[field]===null || !ready())return;
      observer.disconnect();const dom=performance.now()-window[field];
      requestAnimationFrame(()=>requestAnimationFrame(()=>{window.fixtureSafetyResult={dom,paintOpportunity:performance.now()-window[field]};}));
    });
    observer.observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true,attributes:true});
    if(kind==='permission')document.querySelector('[data-action="navigate"][data-screen="ai-history"]').click();
    else {
      window.fixtureClockOffset+=61000;
      document.querySelector('[data-action="pull-refresh"]').click();
      document.querySelector('[data-device-ref="fixture-0"]').click();
    }
  },kind);
  await page.waitForFunction(()=>window.fixtureSafetyResult!==null,null,{timeout:30000});
  return page.evaluate(()=>window.fixtureSafetyResult);
}
async function navigationRetest(page) {
  // Reproduce the original hot-context workload, including update preparation.
  // Cold samples in other contexts are omitted; no inter-click pause is added.
  const updates=async (size,iteration)=>page.evaluate(async ({size,iteration})=>{
    await new Promise((done,reject)=>{
      const expected=Array.from({length:size},(_,i)=>['fixture-'+i,'更新 '+iteration+' / '+i]);
      const check=()=>{if(!expected.every(([id,text])=>document.querySelector('[data-device-ref="'+id+'"] .device-row__title')?.textContent===text))return;clearTimeout(timer);observer.disconnect();done();};
      const observer=new MutationObserver(check);observer.observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true});
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Retest update missing'));},30000);
      for(const [id,displayName] of expected)window.fixtureSockets.at(-1).onmessage({data:JSON.stringify({version:1,type:'device_update',timestamp:Date.now(),payload:{id,displayName}})});
      check();
    });
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  },{size,iteration});
  for(let i=0;i<5;i++)await updates(20,-i-1);
  for(let i=0;i<samples;i++){await updates(1,i*2);await updates(20,i*2+1);}
  const click=[],returnHome=[];
  const navigate=screen=>page.evaluate(async screen=>{
    const start=performance.now();document.querySelector('.bottom-nav [data-screen="'+screen+'"]').click();
    if(!document.querySelector('.screen[data-screen="'+screen+'"]'))throw new Error('Retest navigation failed');
    const dom=performance.now()-start;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    return {dom,paintOpportunity:performance.now()-start};
  },screen);
  for(let i=0;i<samples;i++){click.push(await navigate('activity'));returnHome.push(await navigate('devices'));}
  return {click,returnHome};
}
try {
  for(const rate of rates) for(let round=0;round<rounds;round++) {
    const names=['baseline','candidate'];if((round+roundOffset)%2)names.reverse();
    for(const name of names) {
      console.log(name+' CPU '+rate+'x workflow round '+(round+1));
      const row={build:name,rate,round:round+roundOffset+1,ack:[],failed:[],warmups:{ack:[],failed:[],permission:[],offline:[]},errors:[]};report.results.push(row);
      const m=await mount(name,rate);
      try {
        if(navigationOnly)Object.assign(row,await navigationRetest(m.page));
        else {
        await m.page.locator('[data-device-ref="fixture-0"]').click();
        await m.page.locator('.switch-button').waitFor();
        for(let i=0;i<samples+5;i++) {
          await command(m.page,'SENT',i*4);(i<5?row.warmups.ack:row.ack).push(await command(m.page,'ACKNOWLEDGED',i*4+1));
          await command(m.page,'SENT',i*4+2);(i<5?row.warmups.failed:row.failed).push(await command(m.page,'FAILED',i*4+3));
        }
        await m.page.locator('.bottom-nav [data-screen="devices"]').click();
        const callsBeforeNoop=m.calls.length;
        row.noop=await m.page.evaluate(async ()=>{
          const list=document.querySelector('[data-region="device-list"]'),first=list.firstElementChild;
          let mutations=0;const observer=new MutationObserver(rows=>mutations+=rows.length);observer.observe(list,{subtree:true,childList:true,attributes:true,characterData:true});
          for(let i=0;i<20;i++)window.fixtureSockets.at(-1).onmessage({data:JSON.stringify({version:1,timestamp:Date.now(),type:'device_update',payload:{id:'fixture-0',displayName:'合成设备 0'}})});
          await new Promise(done=>setTimeout(done,300));observer.disconnect();return {mutations,sameRow:first===list.firstElementChild};
        });
        row.noop.networkRequests=m.calls.length-callsBeforeNoop;
        row.resume=await m.page.evaluate(async ()=>{
          let hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
          document.dispatchEvent(new Event('visibilitychange'));
          for(let i=0;i<20;i++)window.fixtureSockets.at(-1).onmessage({data:JSON.stringify({version:1,timestamp:Date.now(),type:'device_update',payload:{id:'fixture-0',displayName:'恢复最新 '+i}})});
          await new Promise(done=>setTimeout(done,200));
          const before=document.querySelector('[data-device-ref="fixture-0"] .device-row__title').textContent,start=performance.now();hidden=false;document.dispatchEvent(new Event('visibilitychange'));
          await new Promise((done,reject)=>{const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Resume state missing'));},30000);
            const observer=new MutationObserver(()=>{if(document.querySelector('[data-device-ref="fixture-0"] .device-row__title').textContent==='恢复最新 19'){clearTimeout(timer);observer.disconnect();done();}});observer.observe(document.getElementById('app'),{childList:true,subtree:true,characterData:true});});
          return {before,latest:document.querySelector('[data-device-ref="fixture-0"] .device-row__title').textContent,dom:performance.now()-start};
        });
        await m.page.locator('.bottom-nav [data-screen="ai"]').click();
        await m.page.locator('#ai-question').waitFor();
        for(const count of [100,500]) {
          m.fixture.messageCount=count;
          await m.page.locator('[data-action="navigate"][data-screen="ai-history"]').click();
          await m.page.locator('[data-action="ai-select"]').click();
          await m.page.waitForFunction(()=>document.querySelectorAll('.ai-message').length===20);
          for(let n=20;n<count;n+=20) {await m.page.waitForFunction(n=>document.querySelectorAll('.ai-message').length===n,n);await m.page.locator('[data-action="ai-messages-more"]').click();}
          await m.page.waitForFunction(n=>document.querySelectorAll('.ai-message').length===n,count);
          row['ai'+count]=await input(m.page);
          const value=row['ai'+count];
          if(!value.sameField || !value.sameMessage || value.selection!==value.value.length || value.scrollBefore!==value.scrollAfter || value.created>=400 || value.messages!==count) row.errors.push('AI input invariants failed at '+count);
        }
        row.permission=[];
        for(let i=0;i<samples+5;i++) {
          m.fixture.denyHistory=true;(i<5?row.warmups.permission:row.permission).push(await measureSafety(m.page,'permission'));
          if(await m.page.locator('#ai-question, .ai-message, .ai-history-item').count())row.errors.push('Permission revocation retained private content');
          m.fixture.denyHistory=false;
          await m.page.locator('[data-action="ai-reload"]').first().click();
          await m.page.locator('.ai-history-item').waitFor();
          await m.page.locator('.bottom-nav [data-screen="ai"]').click();
          await m.page.locator('#ai-question').waitFor();
          await m.page.locator('#ai-question').fill('待清理草稿 '+i);
        }
        row.offline=[];
        for(let i=0;i<samples+5;i++) {
          await m.page.locator('.bottom-nav [data-screen="devices"]').click();
          m.fixture.deviceOffline=true;(i<5?row.warmups.offline:row.offline).push(await measureSafety(m.page,'offline'));
          const enabled=await m.page.locator('[data-region="device-controls"] button:not(:disabled), [data-region="device-controls"] input:not(:disabled), [data-region="device-controls"] select:not(:disabled)').count();
          if(enabled)row.errors.push('Cached platform state allowed device control');
          await m.page.locator('.bottom-nav [data-screen="devices"]').click();
          if(await m.page.locator('[data-action="open-device"]').count()!==200)row.errors.push('Offline refresh lost cached devices');
          m.fixture.deviceOffline=false;
          await m.page.evaluate(()=>{window.fixtureClockOffset+=61000;document.querySelector('[data-action="pull-refresh"]').click();});
          await m.page.waitForFunction(()=>!document.querySelector('.screen').textContent.includes('离线快照') && !document.querySelector('[data-action="pull-refresh"]').disabled);
        }
        }
        row.apiCalls=m.calls;
        row.errors.push(...m.errors,...await m.page.evaluate(()=>window.fixtureWsErrors));
        if (!navigationOnly && (!row.noop.sameRow || row.noop.mutations!==0)) row.errors.push('Unchanged state replaced or mutated rows');
        if (!navigationOnly && row.noop.networkRequests!==0) row.errors.push('Unchanged device pushes caused network reads');
        if (!navigationOnly && (row.resume.before==='恢复最新 19' || row.resume.latest!=='恢复最新 19')) row.errors.push('Visibility suspension/resume failed');
      } finally {await m.context.close();}
      await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({build:name,rate,round:round+1,ack:row.ack.length,failed:row.failed.length,ai100:row.ai100?.created,ai500:row.ai500?.created,errors:row.errors}));
    }
  }
} catch(error) {report.failures.push(error.stack || error.message);process.exitCode=1;}
finally {
  if(report.results.some(row=>row.errors.length))process.exitCode=1;
  await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
  await browser.close();await Promise.all(servers.map(server=>new Promise(done=>server.close(done))));
}
