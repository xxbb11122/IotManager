import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLE_GLASS_CSS,
  injectAppleGlassStyles,
  createUniversalHeader,
  createHomeKitTile,
  createDeviceListContainer,
  createNativeFluidSlider,
  createFluidSlider,
  createQuickControlSheet,
  createDeviceDetailView,
  createBottomNav,
  createCrystalAiComposer,
  createAiMessageList,
  createBleScannerView,
  createActivityStreamView
} from '../apple-glass-standalone.js';

/**
 * 完整轻量级 Node.js 内存 DOM 模拟器
 */
function createMockDocument() {
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      style: {},
      dataset: {},
      attributes: {},
      children: [],
      listeners: {},
      innerHTMLVal: '',
      textContentVal: '',
      value: '',
      type: '',
      title: '',
      disabled: false,
      isFocused: false,
      parentElement: null,
      classList: {
        add(c) {
          const list = el.className ? el.className.split(/\s+/) : [];
          if (!list.includes(c)) el.className = (el.className + ' ' + c).trim();
        },
        remove(c) {
          const list = el.className ? el.className.split(/\s+/) : [];
          el.className = list.filter(x => x !== c).join(' ').trim();
        },
        contains(c) {
          const list = el.className ? el.className.split(/\s+/) : [];
          return list.includes(c);
        }
      },
      setAttribute(k, v) {
        el.attributes[k] = String(v);
        el.dataset[k] = v;
        if (k === 'aria-selected' || k === 'aria-checked') {
          el[k] = String(v);
        }
      },
      getAttribute(k) {
        return el.attributes[k] !== undefined ? el.attributes[k] : (el.dataset[k] ?? null);
      },
      removeAttribute(k) {
        delete el.attributes[k];
        delete el.dataset[k];
      },
      set textContent(v) { el.textContentVal = String(v); },
      get textContent() {
        if (el.textContentVal) return el.textContentVal;
        if (el.children.length) {
          return el.children.map(c => c.textContent || '').join(' ');
        }
        return el.innerHTMLVal ? el.innerHTMLVal.replace(/<[^>]*>/g, '') : '';
      },
      set innerHTML(html) { el.innerHTMLVal = html; },
      get innerHTML() { return el.innerHTMLVal; },
      append(...nodes) {
        nodes.forEach(n => {
          if (typeof n === 'string') {
            el.children.push({ tagName: '#TEXT', textContentVal: n, textContent: n, parentElement: el });
          } else if (n) {
            n.parentElement = el;
            el.children.push(n);
          }
        });
      },
      appendChild(node) {
        el.append(node);
        return node;
      },
      remove() {
        if (el.parentElement) {
          el.parentElement.children = el.parentElement.children.filter(c => c !== el);
        }
      },
      focus() { el.isFocused = true; },
      blur() { el.isFocused = false; },
      addEventListener(type, fn) {
        (el.listeners[type] = el.listeners[type] || []).push(fn);
      },
      dispatchEvent(evt) {
        if (evt.target?.value !== undefined) {
          el.value = String(evt.target.value);
        }
        const handlers = el.listeners[evt.type] || [];
        handlers.forEach(fn => fn(evt));
      },
      querySelector(selector) {
        return el.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const results = [];
        function walk(node) {
          for (const child of (node.children || [])) {
            if (matches(child, selector)) {
              results.push(child);
            }
            walk(child);
          }
        }
        walk(el);
        return results;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 200, height: 48 };
      }
    };

    function matches(node, sel) {
      if (!node || !node.tagName || node.tagName === '#TEXT') return false;
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const list = node.className ? node.className.split(/\s+/) : [];
        return list.includes(cls);
      }
      if (sel.startsWith('#')) {
        return node.id === sel.slice(1);
      }
      if (sel.includes('[')) {
        const tag = sel.split('[')[0];
        if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        const attrMatch = sel.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
        if (attrMatch) {
          const attr = attrMatch[1];
          const val = attrMatch[2];
          const actualVal = (node[attr] !== undefined && node[attr] !== '') ? node[attr] : (node.getAttribute ? node.getAttribute(attr) : node.attributes?.[attr]);
          if (val !== undefined) return String(actualVal) === String(val);
          return actualVal !== undefined && actualVal !== null;
        }
      }
      return node.tagName.toLowerCase() === sel.toLowerCase();
    }

    return el;
  }

  const head = createElement('head');

  return {
    createElement,
    head,
    getElementById(id) {
      function findId(node) {
        if (node.id === id) return node;
        for (const c of (node.children || [])) {
          const found = findId(c);
          if (found) return found;
        }
        return null;
      }
      return findId(head);
    }
  };
}

test('Apple Glass standalone stylesheet contains all essential design tokens and classes', () => {
  assert.match(APPLE_GLASS_CSS, /--glass-surface/);
  assert.match(APPLE_GLASS_CSS, /--glass-blur/);
  assert.match(APPLE_GLASS_CSS, /--glass-border-specular/);
  assert.match(APPLE_GLASS_CSS, /--touch-target: 48px/);
  assert.match(APPLE_GLASS_CSS, /\.universal-app-header/);
  assert.match(APPLE_GLASS_CSS, /\.crystal-glass/);
  assert.match(APPLE_GLASS_CSS, /\.glass-slider-well/);
  assert.match(APPLE_GLASS_CSS, /\.liquid-fill/);
  assert.match(APPLE_GLASS_CSS, /\.crystal-siri/);
  assert.match(APPLE_GLASS_CSS, /\.universal-bottom-nav/);
  assert.match(APPLE_GLASS_CSS, /\.glass-theme-solid/);
  assert.match(APPLE_GLASS_CSS, /@container \(min-width: 612px\)/);
});

test('injectAppleGlassStyles mounts stylesheet once without duplication', () => {
  const mockDoc = createMockDocument();
  const styleEl = injectAppleGlassStyles(mockDoc);
  assert.equal(styleEl.id, 'apple-glass-standalone-stylesheet');
  assert.equal(mockDoc.head.children.length, 1);

  // 第二次调用不应重复追加
  const styleEl2 = injectAppleGlassStyles(mockDoc);
  assert.equal(styleEl2.id, 'apple-glass-standalone-stylesheet');
  assert.equal(mockDoc.head.children.length, 1);
});

test('createUniversalHeader renders site info and handles site & scan clicks', () => {
  const mockDoc = createMockDocument();
  let siteClicked = false;
  let scanClicked = false;

  const header = createUniversalHeader({
    siteName: '测试变电站 A',
    siteSub: '上海区域',
    linkStatus: 'BLE 8ms',
    onSiteClick: () => { siteClicked = true; },
    onScanClick: () => { scanClicked = true; },
    documentObject: mockDoc
  });

  assert.equal(header.className, 'universal-app-header');
  assert.equal(header.children.length, 2);

  const siteBtn = header.querySelector('.site-picker-trigger');
  assert.ok(siteBtn);
  siteBtn.dispatchEvent({ type: 'click' });
  assert.equal(siteClicked, true);

  const scanBtn = header.querySelector('.header-scan-btn') || header.querySelector('button[title]');
  assert.ok(scanBtn);
  scanBtn.dispatchEvent({ type: 'click' });
  assert.equal(scanClicked, true);
});

test('createHomeKitTile renders device card, toggles active state and triggers callbacks', () => {
  const mockDoc = createMockDocument();
  let toggled = false;
  let clicked = false;

  const tile = createHomeKitTile({
    id: 'pump-3',
    title: '3号循环泵',
    subtitle: '流量 30 GPM',
    active: true,
    onToggleClick: (isActive, id) => { toggled = true; assert.equal(id, 'pump-3'); assert.equal(isActive, false); },
    onCardClick: (id) => { clicked = true; assert.equal(id, 'pump-3'); },
    documentObject: mockDoc
  });

  assert.equal(tile.dataset.deviceId, 'pump-3');

  // 触发开关
  const toggleBtn = tile.querySelector('.device-interactive-switch') || tile.querySelector('button[role="switch"]');
  assert.ok(toggleBtn);
  toggleBtn.dispatchEvent({ type: 'click', stopPropagation() {} });
  assert.equal(toggled, true);

  // 触发卡片整体点击
  tile.dispatchEvent({ type: 'click' });
  assert.equal(clicked, true);
});

test('createDeviceListContainer renders search input, filter pills and device grid', () => {
  const mockDoc = createMockDocument();
  let searchVal = '';
  let activeFilter = '';

  const list = createDeviceListContainer({
    devices: [
      { id: 'dev-1', name: '阀门 1', status: 'ONLINE', reportedState: { power: true } },
      { id: 'dev-2', name: '水泵 2', status: 'OFFLINE', reportedState: { power: false } }
    ],
    onSearch: (val) => { searchVal = val; },
    onFilterChange: (f) => { activeFilter = f; },
    documentObject: mockDoc
  });

  assert.ok(list.className.includes('device-list-container'));
  assert.equal(list.children.length, 3); // search, pills, grid

  const searchInput = list.querySelector('input');
  assert.ok(searchInput);
  searchInput.dispatchEvent({ type: 'input', target: { value: '阀门' } });
  assert.equal(searchVal, '阀门');

  const pills = list.querySelectorAll('.filter-pill');
  assert.equal(pills.length, 4);
  pills[1].dispatchEvent({ type: 'click' });
  assert.equal(activeFilter, '在线运行');
});

test('createNativeFluidSlider and createFluidSlider handle preview, commit, pointercancel guard and bounds check', () => {
  const mockDoc = createMockDocument();
  let currentVal = 0;
  let committedVal = 0;

  const slider = createFluidSlider({
    value: 60,
    min: 0,
    max: 100,
    onChange: (v) => { currentVal = v; },
    onCommit: (v) => { committedVal = v; },
    documentObject: mockDoc
  });

  const rangeInput = slider.querySelector('input[type="range"]');
  assert.ok(rangeInput);
  assert.equal(rangeInput.value, '60');
  assert.equal(rangeInput.getAttribute('aria-valuenow'), '60');

  // 1. 模拟拖拽滑动实时预览 (F02: input 仅预览，不产生 commit)
  rangeInput.dispatchEvent({ type: 'input', target: { value: '75' } });
  assert.equal(currentVal, 75);
  assert.equal(committedVal, 0); // commit 仍为初始值

  // 2. 模拟释放触控完成提交 (F02: change 触发 commit)
  rangeInput.dispatchEvent({ type: 'change', target: { value: '75' } });
  assert.equal(committedVal, 75);

  // 3. 模拟手势中断取消守卫 (F02: pointercancel 恢复初值，0 额外派发)
  rangeInput.dispatchEvent({ type: 'pointerdown' });
  rangeInput.dispatchEvent({ type: 'input', target: { value: '90' } });
  assert.equal(currentVal, 90);
  rangeInput.dispatchEvent({ type: 'pointercancel' });
  assert.equal(rangeInput.value, '75');

  // 4. 边界校验 (F05: 非法 bounds 自动禁用)
  const invalidSlider = createNativeFluidSlider({
    min: 100,
    max: 10,
    step: -1,
    documentObject: mockDoc
  });
  const invalidInput = invalidSlider.querySelector('input');
  assert.equal(invalidInput.disabled, true);
});

test('createQuickControlSheet renders accessible dialog, closes on cancel and commits target', () => {
  const mockDoc = createMockDocument();
  let closed = false;
  let committed = null;

  const sheetOverlay = createQuickControlSheet({
    device: { id: 'ac-1', name: '变频空调', reportedState: { level: 40 }, desiredState: { level: 40 } },
    onClose: () => { closed = true; },
    onCommitValue: (id, val) => { committed = { id, val }; },
    documentObject: mockDoc
  });

  assert.equal(sheetOverlay.className, 'quick-sheet-overlay');

  // 取消按键
  const cancelBtn = sheetOverlay.querySelector('.sheet-cancel-btn');
  assert.ok(cancelBtn);
  cancelBtn.dispatchEvent({ type: 'click' });
  assert.equal(closed, true);

  // 确认下发
  const confirmBtn = sheetOverlay.querySelector('.sheet-confirm-btn');
  assert.ok(confirmBtn);
  confirmBtn.dispatchEvent({ type: 'click' });
  assert.equal(committed.id, 'ac-1');
});

test('createBottomNav manages 4 tabs and dispatches tab switch', () => {
  const mockDoc = createMockDocument();
  let selectedTab = '';

  const nav = createBottomNav({
    activeTab: 'devices',
    onTabChange: (tab) => { selectedTab = tab; },
    documentObject: mockDoc
  });

  const tabs = nav.querySelectorAll('.nav-tab-btn');
  assert.equal(tabs.length, 4);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');

  // 点击第二个 tab (ai)
  tabs[1].dispatchEvent({ type: 'click' });
  assert.equal(selectedTab, 'ai');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
});

test('createCrystalAiComposer populates input from quick chips, guards IME composing and enforces busy gatekeeper', () => {
  const mockDoc = createMockDocument();
  let sentText = '';
  let draftText = '';

  const composer = createCrystalAiComposer({
    initialDraft: '初始草稿',
    quickPrompts: ['排查水泵异常', '汇总今日告警'],
    onDraftChange: (d) => { draftText = d; },
    onSend: (txt) => { sentText = txt; },
    documentObject: mockDoc
  });

  const chips = composer.querySelectorAll('.quick-chip-btn');
  assert.equal(chips.length, 2);

  const input = composer.querySelector('input');
  assert.ok(input);
  assert.equal(input.value, '初始草稿');

  const sendBtn = composer.querySelector('.ai-composer-send-btn');
  assert.ok(sendBtn);

  // 点击第一个芯片只填入草稿，不违规直接发命令 (F04)
  chips[0].dispatchEvent({ type: 'click' });
  assert.equal(input.value, '排查水泵异常');
  assert.equal(draftText, '排查水泵异常');
  assert.equal(sentText, ''); // 严格未发送

  // IME 回车防误发 (F04: isComposing=true 时阻断回车发送)
  input.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: true, preventDefault() {} });
  assert.equal(sentText, '');

  // 正常回车或点击发送
  sendBtn.dispatchEvent({ type: 'click' });
  assert.equal(sentText, '排查水泵异常');
  assert.equal(input.value, ''); // 发送后清空

  // Busy 门禁阻断 (F04)
  const busyComposer = createCrystalAiComposer({
    isBusy: true,
    documentObject: mockDoc
  });
  const busyInput = busyComposer.querySelector('input');
  const busySendBtn = busyComposer.querySelector('.ai-composer-send-btn');
  assert.equal(busyInput.disabled, true);
  assert.equal(busySendBtn.disabled, true);
});

test('createAiMessageList renders chat bubbles and supports copy', () => {
  const mockDoc = createMockDocument();
  let copiedText = '';

  const stream = createAiMessageList({
    messages: [
      { role: 'USER', content: '请分析给水泵' },
      { role: 'ASSISTANT', content: '水泵工作状态正常，无故障码。' }
    ],
    onCopy: (txt) => { copiedText = txt; },
    documentObject: mockDoc
  });

  assert.equal(stream.children.length, 2);
  const copyBtn = stream.querySelector('.copy-btn');
  assert.ok(copyBtn);
  copyBtn.dispatchEvent({ type: 'click' });
  assert.equal(copiedText, '水泵工作状态正常，无故障码。');
});

test('createBleScannerView and createActivityStreamView render properly and handle actions', () => {
  const mockDoc = createMockDocument();
  let claimedCand = null;
  let qrTriggered = false;

  const scanner = createBleScannerView({
    candidates: [{ id: 'dev-9', name: 'Shelly Switch', mac: 'AA:BB:CC', rssi: -50 }],
    onClaim: (c) => { claimedCand = c; },
    onQrScan: () => { qrTriggered = true; },
    documentObject: mockDoc
  });

  const qrBtn = scanner.querySelector('.qr-scan-btn');
  assert.ok(qrBtn);
  qrBtn.dispatchEvent({ type: 'click' });
  assert.equal(qrTriggered, true);

  const claimBtn = scanner.querySelector('.claim-btn');
  assert.ok(claimBtn);
  claimBtn.dispatchEvent({ type: 'click' });
  assert.equal(claimedCand.name, 'Shelly Switch');

  // 活动流组件测试
  const activity = createActivityStreamView({
    events: [
      { id: '1', type: 'COMMAND', title: '开度下发', desc: '成功', time: '12:00' },
      { id: '2', type: 'ALERT', title: '温度超限', desc: '超阈值', time: '12:05' }
    ],
    documentObject: mockDoc
  });
  assert.equal(activity.children.length, 3); // 标题 + 2条卡片
});

test('F01 & F03 Compliance: XSS immunity and reported vs desired state separation', () => {
  const mockDoc = createMockDocument();
  const dangerousString = '<img src=x onerror=alert(1)>';

  // F01: 恶意输入在组件内必须作为 textContent 安全挂载，杜绝 innerHTML 插值
  const tile = createHomeKitTile({
    id: dangerousString,
    title: dangerousString,
    subtitle: dangerousString,
    documentObject: mockDoc
  });
  assert.equal(tile.innerHTML, ''); // 杜绝 innerHTML 拼接

  // F03: 明确展示已上报事实 (Reported) 与期望目标 (Desired)
  const detail = createDeviceDetailView({
    device: {
      name: '工业调光器',
      reportedState: { level: 20 },
      desiredState: { level: 80 }
    },
    documentObject: mockDoc
  });
  const textAll = detail.textContent;
  assert.match(textAll, /上报事实/);
  assert.match(textAll, /期望目标/);
  assert.match(textAll, /20/);
  assert.match(textAll, /80/);
});
