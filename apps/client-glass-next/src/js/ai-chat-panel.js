// This panel keeps AI state entirely in memory. A site, identity or endpoint
// transition aborts pending requests and clears every answer and citation.
export function createAiChatPanel({ apiProvider, siteIdProvider }) {
  const style = document.createElement('style');
  style.textContent = [
    '.iot-ai-open{position:fixed;right:1rem;bottom:1rem;z-index:9000;padding:.8rem 1rem;border:0;border-radius:999px;background:#145e66;color:white;font:600 14px system-ui;box-shadow:0 6px 20px #1236}',
    '.iot-ai-panel{position:fixed;inset:auto 0 0;z-index:9001;max-height:min(82vh,700px);overflow:auto;background:#fff;border-radius:18px 18px 0 0;padding:1.2rem;box-shadow:0 -8px 32px #1233;font:14px/1.5 system-ui;color:#18373c}',
    '.iot-ai-panel[hidden],.iot-ai-open[hidden]{display:none!important}',
    '.iot-ai-panel header{display:flex;justify-content:space-between;align-items:center;gap:1rem}',
    '.iot-ai-panel textarea{box-sizing:border-box;width:100%;min-height:90px;padding:.75rem;border:1px solid #b6c9cc;border-radius:8px;font:inherit}',
    '.iot-ai-panel button{padding:.6rem .8rem;border:1px solid #adc7ca;border-radius:8px;background:#f1f8f8;color:#155b63;font:inherit}',
    '.iot-ai-panel form{display:grid;gap:.6rem;margin-top:1rem}',
    '.iot-ai-answer{white-space:pre-wrap;max-height:32vh;overflow:auto}',
    '.iot-ai-citations{font-size:12px;color:#52666a}'
  ].join('\n');
  document.head.append(style);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'iot-ai-open';
  openButton.textContent = '站点 AI';
  openButton.setAttribute('aria-label', '打开站点 AI 问答');
  const panel = document.createElement('section');
  panel.className = 'iot-ai-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '站点 AI 问答');
  panel.innerHTML = '<header><strong>站点 AI 问答</strong><button type="button" data-action="close" aria-label="关闭">关闭</button></header>' +
    '<p>可回答通用问题；站点资料需启用知识库，设备状态只读。设备操作仍需在原界面确认。</p>' +
    '<form><label for="iot-ai-question">问题</label><textarea id="iot-ai-question" maxlength="2000" required></textarea>' +
    '<div><button type="submit">提问</button> <button type="button" data-action="new">新会话</button></div></form>' +
    '<p class="iot-ai-answer" aria-live="polite"></p><div class="iot-ai-citations"></div>';
  document.body.append(openButton, panel);
  const answer = panel.querySelector('.iot-ai-answer');
  const citations = panel.querySelector('.iot-ai-citations');
  const question = panel.querySelector('textarea');
  let conversationId = null;
  let revision = 0;
  let pending = null;

  function reset() {
    revision += 1;
    pending?.abort();
    pending = null;
    conversationId = null;
    question.value = '';
    answer.textContent = '';
    citations.replaceChildren();
    panel.hidden = true;
  }

  function available() {
    return Boolean(apiProvider() && siteIdProvider() && globalThis.navigator?.onLine !== false);
  }

  function updateAvailability() {
    const enabled = available();
    openButton.hidden = !enabled;
    if (!enabled) reset();
  }

  openButton.addEventListener('click', () => {
    updateAvailability();
    if (!available()) return;
    panel.hidden = false;
    question.focus();
  });
  panel.querySelector('[data-action="close"]').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('[data-action="new"]').addEventListener('click', () => {
    reset();
    panel.hidden = false;
    question.focus();
  });
  panel.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!available()) { reset(); return; }
    const requestRevision = revision;
    const siteId = siteIdProvider();
    const api = apiProvider();
    const controller = new AbortController();
    pending?.abort();
    pending = controller;
    answer.textContent = '正在回答…';
    citations.replaceChildren();
    try {
      const reply = await api.askAi(siteId, question.value.trim(), conversationId, { signal: controller.signal });
      if (requestRevision !== revision || controller.signal.aborted || siteIdProvider() !== siteId || apiProvider() !== api) return;
      conversationId = reply.conversationId;
      answer.textContent = reply.answer || '';
      for (const citation of reply.citations || []) {
        const item = document.createElement('p');
        item.textContent = citation.documentName + ' · v' + citation.version +
          (citation.pageNumber ? ' · 第 ' + citation.pageNumber + ' 页' : '') + '：' + citation.snippet;
        citations.append(item);
      }
    } catch (error) {
      if (requestRevision === revision && error.name !== 'AbortError') {
        answer.textContent = error.status === 404 ? '站点 AI 尚未开启。' : '问答失败：' + error.message;
      }
    } finally {
      if (pending === controller) pending = null;
    }
  });
  globalThis.addEventListener?.('offline', updateAvailability);
  globalThis.addEventListener?.('online', updateAvailability);
  updateAvailability();
  return { reset, updateAvailability };
}
