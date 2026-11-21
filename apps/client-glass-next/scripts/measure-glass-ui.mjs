// Production-only, loopback-only comparison. No application diagnostics or
// development fixture modules are imported into either build.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {cpus, platform, release} from 'node:os';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
if (!options.baseline || !options.out) throw new Error('Use --baseline=ABS_BUILD --out=ABS_OUTPUT [--candidate=ABS_BUILD] [--samples=30] [--rounds=3]');
const output = resolve(options.out), samples = Number(options.samples || 30), rounds = Number(options.rounds || 3);
const rates = (options.rates || '1,4').split(',').map(Number);
if (![samples, rounds, ...rates].every(value => Number.isInteger(value) && value > 0)) throw new Error('Invalid sample, round or CPU rate');
await mkdir(output, {recursive:true});
const builds = {baseline:resolve(options.baseline), ...(options.candidate ? {candidate:resolve(options.candidate)} : {})};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const servers = [];
for (const [name, root] of Object.entries(builds)) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + sep)) {response.writeHead(403).end(); return;}
      const bytes = await readFile(file);
      const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
        '.json':'application/json', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8'};
      response.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'}).end(bytes);
    } catch {response.writeHead(404).end();}
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  builds[name] = {root, origin:'http://127.0.0.1:' + server.address().port,
    indexSha256:hash(await readFile(resolve(root, 'index.html')))};
}
const browser = await chromium.launch();
const report = {createdAt:new Date().toISOString(), browser:browser.version(), node:process.version,
  mode:options['boundaries-only']==='true'?'boundaries':'full',
  machine:{platform:platform(), release:release(), cpu:cpus()[0]?.model, logicalCpus:cpus().length},
  viewport:{width:390,height:844}, motion:'reduced', samples, rounds, cpuRates:rates, builds,
  scriptSha256:hash(await readFile(new URL(import.meta.url))), results:[], failures:[]};
function summary(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {n:sorted.length, min:sorted[0] ?? null, p50:percentile(.5), p95:percentile(.95), max:sorted.at(-1) ?? null};
}
async function mount(name, count, rate) {
  const {origin} = builds[name], failures = [], calls = [];
  const devices = Array.from({length:count}, (_, index) => ({
    id:'fixture-' + index, deviceId:'public-' + index, displayName:'合成设备 ' + index,
    siteCode:'perf-site', spacePath:'/test/workshop', online:true,
    connections:[{transport:'LAN_AGENT', status:'CONNECTED', profileId:'fixture-relay'}],
    capabilities:{profileId:'fixture-relay', controls:[{id:'power', label:'电源', valueType:'boolean', stateKey:'on', commandType:'set_power'}]},
    reportedState:{on:true}, desiredState:{on:true}
  }));
  const context = await browser.newContext({viewport:report.viewport, reducedMotion:'reduce', serviceWorkers:'block'});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) {failures.push('external request: ' + url.origin); await route.abort(); return;}
    if (!url.pathname.startsWith('/api/')) {await route.continue(); return;}
    calls.push({method:request.method(), path:url.pathname});
    const reply = body => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(body)});
    if (url.pathname === '/api/v1/me') return reply({subject:'synthetic-owner', roles:['OWNER'], sites:[{id:1}]});
    if (url.pathname === '/api/v1/sites') return reply([{id:1, siteCode:'perf-site', siteName:'模拟装配车间', organizationCode:'perf-org', organizationName:'测试园区'}]);
    if (url.pathname === '/api/v1/devices') return reply(devices);
    if (url.pathname.startsWith('/api/v1/devices/')) {
      if (url.pathname.endsWith('/activity')) return reply([]);
      return reply(devices.find(row => row.id === url.pathname.split('/')[4]) || devices[0]);
    }
    if (url.pathname.endsWith('/weather-settings')) return reply({latitude:0,longitude:0,timezone:'UTC',locationSource:'MANUAL'});
    if (url.pathname.endsWith('/weather/forecast')) return reply({status:'FRESH',hourly:[],daily:[]});
    if (url.pathname.endsWith('/ai/status')) return reply({enabled:true});
    if (url.pathname.endsWith('/ai/capabilities')) return reply({contractVersion:1,features:{history:true,idempotency:true,requestRecovery:true,personaActivationGuard:true}});
    if (url.pathname.endsWith('/ai/persona')) return reply({version:0,name:'默认性格',instructions:''});
    if (url.pathname.endsWith('/ai/persona/versions')) return reply([]);
    if (url.pathname.endsWith('/weather')) return reply({siteCode:'perf-site',status:'FRESH',fetchedAt:'2026-10-30T08:00:00Z',
      current:{conditionText:'多云',iconKey:'cloudy',temperatureC:24,relativeHumidityPct:50}, indicators:{}});
    return reply([]);
  });
  await context.addInitScript(({origin, count}) => {
    localStorage.setItem('CapacitorStorage.iot-manager.active-endpoint.v1', JSON.stringify({id:'perf-only',accessRoute:'SITE_API',
      apiBaseUrl:origin + '/api/v1',wsUrl:origin.replace('http:', 'ws:') + '/ws/devices',organizationCode:'perf-org',accessToken:'synthetic-not-a-real-token'}));
    localStorage.setItem('CapacitorStorage.iot-manager.selected-site.v1', JSON.stringify({siteCode:'perf-site'}));
    window.fixtureSockets = [];
    window.fixtureWsViolations = [];
    window.WebSocket = class {
      constructor(url) {
        if (new URL(url).host !== new URL(origin).host) window.fixtureWsViolations.push(String(url));
        this.readyState=0; window.fixtureSockets.push(this); setTimeout(() => {this.readyState=1; this.onopen?.({});},0);
      }
      send() {}
      close() {this.readyState=3; this.onclose?.({code:1000});}
      addEventListener(type, listener) {this['on' + type]=listener;}
      removeEventListener(type, listener) {if(this['on' + type]===listener) delete this['on' + type];}
    };
    window.measureLongTasks = [];
    window.supportsLongTasks = PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (window.supportsLongTasks) new PerformanceObserver(list => window.measureLongTasks.push(...list.getEntries().map(row => ({start:row.startTime,duration:row.duration}))))
      .observe({type:'longtask',buffered:true});
    const check = () => {
      if (window.firstFixtureVisible != null || document.getElementById('startup-overlay')) return;
      const target = document.querySelector(count ? '[data-action="open-device"]' : '.empty-state');
      if (target?.getBoundingClientRect().height > 0) window.firstFixtureVisible=performance.now();
    };
    new MutationObserver(check).observe(document, {subtree:true,childList:true,attributes:true});
  }, {origin,count});
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', {rate});
  try {
    await page.goto(origin, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.firstFixtureVisible != null, null, {timeout:60000});
    if (count) await page.waitForFunction(() => window.fixtureSockets.at(-1)?.readyState === 1);
    const rendered=await page.locator('[data-action="open-device"]').count();
    if (rendered !== count) throw new Error('Expected ' + count + ' devices, rendered ' + rendered);
    failures.push(...await page.evaluate(()=>window.fixtureWsViolations.map(url=>'unexpected WS endpoint: ' + url)));
    return {page, context, failures, calls, cold:await page.evaluate(() => window.firstFixtureVisible)};
  } catch(error) {
    const diagnostic=await page.evaluate(()=>({rendered:document.querySelectorAll('[data-action="open-device"]').length,
      sockets:window.fixtureSockets?.map(socket=>socket.readyState),startup:document.querySelector('#startup-overlay')?.textContent?.slice(0,250),
      notices:[...document.querySelectorAll('.notice')].map(node=>node.textContent)})).catch(()=>null);
    await context.close();throw new Error(error.message+'; fixture diagnostic: '+JSON.stringify(diagnostic));
  }
}
async function update(page, size, iteration) {
  return page.evaluate(async ({size,iteration}) => {
    const start=performance.now();
    const expected=Array.from({length:size},(_,index) => ['fixture-' + index, '更新 ' + iteration + ' / ' + index]);
    let timeout, observer;
    await new Promise((done,reject) => {
      const check=() => {
        if (!expected.every(([id,text]) => document.querySelector('[data-device-ref="' + id + '"] .device-row__title')?.textContent===text)) return;
        clearTimeout(timeout); observer.disconnect(); done();
      };
      observer=new MutationObserver(check); observer.observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true});
      timeout=setTimeout(() => {observer.disconnect(); reject(new Error('Update not presented'));},30000);
      for(const [id,displayName] of expected) window.fixtureSockets.at(-1).onmessage({data:JSON.stringify({version:1,type:'device_update',timestamp:Date.now(),payload:{id,displayName}})});
      check();
    });
    const dom=performance.now()-start;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    return {dom,paintOpportunity:performance.now()-start};
  }, {size,iteration});
}
async function navigate(page, screen) {
  return page.evaluate(async screen => {
    const start=performance.now();
    document.querySelector('.bottom-nav [data-screen="' + screen + '"]').click();
    if (!document.querySelector('.screen[data-screen="' + screen + '"]')) throw new Error('Navigation did not select ' + screen);
    const dom=performance.now()-start;
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    return {dom,paintOpportunity:performance.now()-start};
  },screen);
}
try {
  if(options['boundaries-only']!=='true') for (const rate of rates) for(let round=0; round<rounds; round++) {
    const names=Object.keys(builds); if(round % 2) names.reverse();
    for(const name of names) {
      const row={build:name,rate,round:round+1,devices:200,cold:[],single:[],batch20:[],click:[],returnHome:[],scroll:[],errors:[]};
      report.results.push(row);
      console.log(name + ' CPU ' + rate + 'x round ' + (round+1));
      for(let sample=0;sample<samples;sample++) {
        try {
          const mounted=await mount(name,200,rate);
          row.cold.push(mounted.cold); row.errors.push(...mounted.failures);
          if(sample===0 && round===0) await mounted.page.screenshot({path:resolve(output,name + '-' + rate + 'x-home.png')});
          await mounted.context.close();
        } catch(error) {row.errors.push('cold: ' + error.message); row.cold.push(null);}
      }
      const mounted=await mount(name,200,rate);
      try {
        for(let i=0;i<5;i++) await update(mounted.page,20,-i-1);
        for(let i=0;i<samples;i++) {
          try {row.single.push(await update(mounted.page,1,i*2)); row.batch20.push(await update(mounted.page,20,i*2+1));}
          catch(error) {row.errors.push('update: ' + error.message);}
        }
        for(let i=0;i<samples;i++) {
          try {row.click.push(await navigate(mounted.page,'activity')); row.returnHome.push(await navigate(mounted.page,'devices'));}
          catch(error) {row.errors.push('navigation: ' + error.message);}
        }
        for(let i=0;i<3;i++) row.scroll.push(await mounted.page.evaluate(async () => {
          window.scrollTo(0,0);
          const start=performance.now(), max=Math.min(1000,document.documentElement.scrollHeight-innerHeight), frames=[];
          await new Promise(done => {
            let last=start;
            const step=now => {frames.push(now-last);last=now;window.scrollTo(0,max*Math.min(1,(now-start)/2000)); if(now-start<2000) requestAnimationFrame(step); else done();};
            requestAnimationFrame(step);
          });
          await new Promise(done => setTimeout(done,100));
          const tasks=window.supportsLongTasks ? window.measureLongTasks.filter(row => row.start>=start) : null;
          return {distance:max,frames,longTasks:tasks?.length ?? null,longTaskMs:tasks?.reduce((sum,row)=>sum+row.duration,0) ?? null};
        }));
        row.optics=await mounted.page.locator('[data-region="device-list"] liquid-glass').count();
        row.errors.push(...mounted.failures);
        row.unexpectedWrites=mounted.calls.filter(call => !['GET','HEAD'].includes(call.method));
      } finally {await mounted.context.close();}
      row.summary={cold:summary(row.cold.filter(Number.isFinite)),single:summary(row.single.map(sample=>sample.dom)),
        batch20:summary(row.batch20.map(sample=>sample.dom)),singlePaintProxy:summary(row.single.map(sample=>sample.paintOpportunity)),
        clickProxy:summary(row.click.map(sample=>sample.paintOpportunity)),returnHome:summary(row.returnHome.map(sample=>sample.dom))};
      await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({build:name,rate,round:round+1,optics:row.optics,summary:row.summary,errors:row.errors.length}));
    }
  }
  for(const rate of rates) for(const name of Object.keys(builds)) for(const count of [0,50,1000]) {
    let mounted;
    try {
      mounted=await mount(name,count,rate);
      const row={build:name,rate,devices:count,cold:mounted.cold,optics:await mounted.page.locator('[data-region="device-list"] liquid-glass').count(),errors:mounted.failures,
        batch20:count ? await update(mounted.page,Math.min(20,count),10000) : null,
        unexpectedWrites:mounted.calls.filter(call=>!['GET','HEAD'].includes(call.method))};
      report.results.push(row);
      await mounted.page.screenshot({path:resolve(output,name + '-' + rate + 'x-' + count + '.png')});
    } catch(error) {report.results.push({build:name,rate,devices:count,errors:[error.stack || error.message]});}
    finally {await mounted?.context.close();await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));}
  }
} catch(error) {
  report.failures.push(error.stack || error.message);
  process.exitCode=1;
} finally {
  if (report.failures.length || report.results.some(row => row.errors?.length || row.unexpectedWrites?.length)) process.exitCode=1;
  await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
  await browser.close();
  await Promise.all(servers.map(server => new Promise(done => server.close(done))));
}
