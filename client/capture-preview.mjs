import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 5178;
const ARTIFACT_DIR = 'C:/Users/Raid/.gemini/antigravity/brain/67cfcc27-4a8a-4d68-a13e-43cdc10c8150';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 440, height: 920 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  console.log(`[Browser] Navigating to http://localhost:${PORT}/apple-glass-preview.html ...`);
  await page.goto(`http://localhost:${PORT}/apple-glass-preview.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 截屏 1: 设备看板主页 (高对比卡片 + 轻毛玻璃顶栏 + 原生触控开关)
  const p1 = path.join(ARTIFACT_DIR, 'compliant_dashboard_light_glass.png');
  await page.screenshot({ path: p1 });
  console.log(`[Screenshot 1] Saved: ${p1}`);

  // 截屏 2: 点击第 2 张设备卡片（日光调光筒灯），唤出原生 Fluid Range 触控抽屉
  const tiles = await page.$$('.device-tile-card[data-device-id]');
  if (tiles.length >= 2) {
    await tiles[1].click();
    await page.waitForTimeout(600);
    const p2 = path.join(ARTIFACT_DIR, 'compliant_control_sheet_slider.png');
    await page.screenshot({ path: p2 });
    console.log(`[Screenshot 2] Saved: ${p2}`);

    // 关闭抽屉
    const cancelBtn = await page.$('.sheet-cancel-btn') || await page.$('.sheet-close-btn');
    if (cancelBtn) await cancelBtn.click();
    await page.waitForTimeout(400);
  }

  // 截屏 3: 点击第 5 张监测设备卡片（微气候综合环境仪），唤出完整遥测与状态比对页
  if (tiles.length >= 5) {
    await tiles[4].click();
    await page.waitForTimeout(600);
    const p3 = path.join(ARTIFACT_DIR, 'compliant_device_detail_view.png');
    await page.screenshot({ path: p3 });
    console.log(`[Screenshot 3] Saved: ${p3}`);

    // 返回列表
    const backBtn = await page.$('.detail-back-btn');
    if (backBtn) await backBtn.click();
    await page.waitForTimeout(400);
  }

  // 截屏 4: 切换到 AI 助手 Tab (草稿保持 + 安全纯文本气泡 + 门禁验证)
  const aiTabBtn = await page.$('.nav-tab-btn[data-tab="ai"]');
  if (aiTabBtn) {
    await aiTabBtn.click();
    await page.waitForTimeout(600);
    const p4 = path.join(ARTIFACT_DIR, 'compliant_ai_composer_tab.png');
    await page.screenshot({ path: p4 });
    console.log(`[Screenshot 4] Saved: ${p4}`);
  }

  // 截屏 5: 切换到 运维审计 Tab
  const actTabBtn = await page.$('.nav-tab-btn[data-tab="activity"]');
  if (actTabBtn) {
    await actTabBtn.click();
    await page.waitForTimeout(600);
    const p5 = path.join(ARTIFACT_DIR, 'compliant_activity_stream_tab.png');
    await page.screenshot({ path: p5 });
    console.log(`[Screenshot 5] Saved: ${p5}`);
  }

  // 截屏 6: 响应式宽屏双列测试 (>=612px 响应式网格验证 F15)
  const devTabBtn = await page.$('.nav-tab-btn[data-tab="devices"]');
  if (devTabBtn) await devTabBtn.click();
  const tabletBtn = await page.$('#btn-width-tablet');
  if (tabletBtn) {
    await tabletBtn.click();
    await page.setViewportSize({ width: 720, height: 920 });
    await page.waitForTimeout(600);
    const p6 = path.join(ARTIFACT_DIR, 'compliant_responsive_grid_640px.png');
    await page.screenshot({ path: p6 });
    console.log(`[Screenshot 6] Saved: ${p6}`);
  }

  // 截屏 7: 实色降级模式 (Solid Mode F11 验证)
  const solidBtn = await page.$('#btn-theme-solid');
  if (solidBtn) {
    await solidBtn.click();
    await page.waitForTimeout(400);
    const p7 = path.join(ARTIFACT_DIR, 'compliant_solid_mode_fallback.png');
    await page.screenshot({ path: p7 });
    console.log(`[Screenshot 7] Saved: ${p7}`);
  }

  await browser.close();
  console.log('[Playwright] All compliant inspection screenshots captured successfully!');
}

main().catch(err => {
  console.error('[Capture Error]', err);
  process.exit(1);
});
