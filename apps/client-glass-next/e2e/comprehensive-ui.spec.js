import {test, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {materialHarness, noHorizontalOverflow} from './helpers/material-harness.js';

test('device list updates aliases, reorders without replacing focused rows and retains the final empty state', async ({page}) => {
  await materialHarness(page);
  await page.evaluate(() => {
    const h=window.materialHarness;
    h.model.devices=h.model.devices.map((row,index) => ({...row,publicId:'alias-' + index}));
    h.ui.render(h.model);
    window.originalDeviceRow=document.querySelector('[data-device-ref="preview-d1"]');
    window.originalDeviceRow.focus();
    h.model.devices[0]={...h.model.devices[0],displayName:'通过别名更新'};
    h.ui.patchDevices(['alias-0'],h.model);
  });
  await expect(page.locator('[data-device-ref="preview-d1"]')).toContainText('通过别名更新');
  await page.evaluate(() => {
    const h=window.materialHarness;
    h.model.devices=[...h.model.devices].reverse(); h.ui.patchDevices([],h.model);
  });
  expect(await page.locator('[data-region="device-list"] > [data-device-ref]').evaluateAll(rows => rows.map(row=>row.dataset.deviceRef)))
    .toEqual(['preview-d2','preview-d1']);
  expect(await page.evaluate(() => document.activeElement===window.originalDeviceRow)).toBe(true);
  await page.evaluate(() => {
    const h=window.materialHarness;
    h.model.devices=[{...h.model.devices[0],displayName:'全量刷新后的名称'}]; h.ui.patchDevices([],h.model);
  });
  await expect(page.locator('.device-row')).toHaveCount(1);
  await expect(page.locator('.device-row')).toContainText('全量刷新后的名称');
  await page.evaluate(() => {const h=window.materialHarness; h.model.devices=[]; h.ui.patchDevices([],h.model);});
  await expect(page.getByRole('heading',{name:'还没有设备',exact:true})).toBeVisible();
  await expect(page.locator('.device-row')).toHaveCount(0);
  await expect(page.locator('.home-actions [data-action="open-add-device"]')).toBeFocused();
});

test('ambiguous device references keep separate rows and are never collapsed by an index', async ({page}) => {
  await materialHarness(page);
  await page.evaluate(() => {
    const h=window.materialHarness, base=h.model.devices[0];
    h.model.devices=[{...base,id:'duplicate',displayName:'第一台'}, {...base,id:'duplicate',displayName:'第二台'},
      {...base,id:undefined,deviceId:undefined,displayName:'缺少标识'}];
    h.ui.patchDevices([],h.model);
  });
  await expect(page.locator('.device-row')).toHaveCount(3);
  await expect(page.locator('.device-row__title')).toHaveText(['第一台','第二台','缺少标识']);
  await expect(page.locator('.device-row:disabled')).toHaveCount(3);
  await expect(page.locator('.device-row__reading').first()).toHaveText('设备标识异常，请刷新设备列表');
  await page.evaluate(() => {
    const h=window.materialHarness;
    h.model.devices=h.model.devices.map((row,index)=>({...row,displayName:'更新 ' + index}));
    h.ui.patchDevices(['duplicate'],h.model);
  });
  await expect(page.locator('.device-row__title')).toHaveText(['更新 0','更新 1','更新 2']);
});

test('large ordinary lists have no optical children in any material and stay single-column', async ({page}, testInfo) => {
  await materialHarness(page);
  await page.evaluate(() => {
    const h=window.materialHarness, base=h.model.devices[0];
    h.model.devices=Array.from({length:200},(_,index)=>({...base,id:'large-' + index,deviceId:'public-' + index,displayName:'合成设备 ' + index}));
    h.ui.render(h.model);
  });
  for(const mode of ['liquid','frosted','solid']) {
    await page.evaluate(mode=>window.materialHarness.ui.glassAppearance.select(mode),mode);
    await expect(page.locator('[data-region="device-list"] liquid-glass')).toHaveCount(0);
    await expect(page.locator('.device-row').first()).toHaveCSS('backdrop-filter','none');
    expect(await page.locator('liquid-glass').count()).toBeLessThanOrEqual(2);
  }
  for(const width of [320,360,390,430,767,768,819,820,1024,1280,1440]) {
    await page.setViewportSize({width,height:844});
    const rows=await page.locator('.device-row').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.getBoundingClientRect().x));
    expect(rows[0]).toBe(rows[1]);
    await noHorizontalOverflow(page);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('home-200-mobile.png'),animations:'disabled'});
});

test('major pages share quiet content surfaces and preserve visible controls with enlarged text', async ({page}, testInfo) => {
  await materialHarness(page);
  for(const [scenario,screen] of [['P01','devices'],['P03','detail'],['P06','activity'],['P07','add'],['P09','ble'],['P11','lan'],
    ['P12','sites'],['P13','connections'],['P18','weather'],['P01','ai-history'],['P01','ai-persona']]) {
    await page.evaluate(config=>window.materialHarness.mount(config),{scenario,screen});
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('.screen-region')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-image','none');
    await expect(page.locator('.screen-region liquid-glass')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.screenshot({path:testInfo.outputPath(screen + '-mobile.png'),animations:'disabled',fullPage:true});
    await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
    await noHorizontalOverflow(page);
    await page.evaluate(()=>{document.documentElement.style.fontSize='';});
  }
});

test('ordinary content mutations do not rescan navigation optics, while navigation changes still synchronize', async ({page}) => {
  await materialHarness(page);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.evaluate(()=> {
    const root=document.getElementById('app'), query=root.querySelectorAll;
    window.materialScans=0;
    root.querySelectorAll=function(selector) {
      if(selector==='.bottom-nav, .primary-nav') window.materialScans++;
      return query.call(this,selector);
    };
    for(let index=0;index<20;index++) document.querySelector('.device-row__title').textContent='遥测显示 ' + index;
  });
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  expect(await page.evaluate(()=>window.materialScans)).toBe(0);
  await page.getByRole('button',{name:'AI',exact:true}).click();
  await expect(page.locator('.bottom-nav [aria-current="page"]')).toHaveAttribute('data-screen','ai');
  await expect.poll(()=>page.evaluate(()=>window.materialScans)).toBeGreaterThan(0);
});

test('editable controls retain a distinct boundary on quiet opaque surfaces', async ({page}) => {
  await materialHarness(page,{screen:'ai-persona'});
  const ratios=await page.locator('.ai-input, .ai-workspace .button--secondary:not(:disabled)').evaluateAll(nodes => {
    const luminance=color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => {
      const x=value/255; return x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4;
    }).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    return nodes.map(node=>{
      const style=getComputedStyle(node), a=luminance(style.borderTopColor), b=luminance(style.backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
  });
  expect(ratios.length).toBeGreaterThan(1);
  for(const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(3);
});

test('zoom-equivalent desktop layout and forced-color mobile states keep actions reachable', async ({page}, testInfo) => {
  await materialHarness(page,{screen:'ai'});
  const session=await page.context().newCDPSession(page);
  // A 1280x900 desktop at 200% page zoom has a 640x450 CSS layout.
  // This emulates that geometry and pixel density; it does not drive browser chrome.
  await session.send('Emulation.setDeviceMetricsOverride',{width:640,height:450,deviceScaleFactor:2,mobile:false,screenWidth:1280,screenHeight:900});
  try {
    expect(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio}))).toEqual({width:640,height:450,scale:2});
    await noHorizontalOverflow(page);
    const input=await page.locator('#ai-question').boundingBox();
    const send=await page.locator('[data-action="ai-send"]').boundingBox();
    const nav=await page.locator('.bottom-nav').boundingBox();
    expect(input.y+input.height).toBeLessThanOrEqual(nav.y+1);
    expect(send.y+send.height).toBeLessThanOrEqual(nav.y+1);
    expect(nav.y+nav.height).toBeLessThanOrEqual(451);
    // Playwright's screenshot helper restores its configured viewport. Capture
    // directly through CDP to preserve the emulated zoom geometry in the PNG.
    const shot=Buffer.from((await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
    expect({width:shot.readUInt32BE(16),height:shot.readUInt32BE(20)}).toEqual({width:1280,height:900});
    await writeFile(testInfo.outputPath('ai-desktop-zoom-equivalent-200.png'),shot);
  } finally {await session.send('Emulation.clearDeviceMetricsOverride');await session.detach();}
  for(const variant of ['empty','cache']) {
    await page.setViewportSize({width:320,height:844});
    await page.evaluate(variant=>window.materialHarness.mount({scenario:'P01',variant,screen:'devices'}),variant);
    await noHorizontalOverflow(page);
    await expect(page.locator('.home-actions [data-action="open-add-device"]')).toBeVisible();
    if(variant==='cache') await expect(page.getByText('离线快照',{exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('home-'+variant+'-320.png'),animations:'disabled'});
  }
  await page.emulateMedia({forcedColors:'active'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass','solid');
  await noHorizontalOverflow(page);
  await page.screenshot({path:testInfo.outputPath('home-forced-colors-320.png'),animations:'disabled'});
});
