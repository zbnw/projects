(() => {
  'use strict';

  const api = globalThis.TimeCrypto;
  const byId = (id) => document.getElementById(id);
  const elements = {
    form: byId('cipherForm'), panel: byId('cipherPanel'), currentDate: byId('currentDate'),
    currentTime: byId('currentTime'), minuteProgress: byId('minuteProgress'),
    windowLabel: byId('windowLabel'), timeStatus: byId('timeStatus'), syncButton: byId('syncButton'),
    secretInput: byId('secretInput'), secretMeta: byId('secretMeta'), modeBadge: byId('modeBadge'),
    modeNotice: byId('modeNotice'), toggleSecret: byId('toggleSecret'), plainInput: byId('plainInput'),
    byteCount: byId('byteCount'), tokenInput: byId('tokenInput'), tokenCount: byId('tokenCount'),
    encryptFields: byId('encryptFields'), decryptFields: byId('decryptFields'),
    submitButton: byId('submitButton'), clearButton: byId('clearButton'), buttonText: byId('buttonText'),
    errorMessage: byId('errorMessage'), statusMessage: byId('statusMessage'), resultBox: byId('resultBox'),
    resultTitle: byId('resultTitle'), resultText: byId('resultText'), expiryBadge: byId('expiryBadge'),
    issuedAtTime: byId('issuedAtTime'), protocolBadge: byId('protocolBadge'),
    resultMode: byId('resultMode'), copyButton: byId('copyButton'), copyButtonText: byId('copyButtonText')
  };
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const missing = Object.entries(elements).filter(([, node]) => !node).map(([id]) => id);
  if (missing.length || tabs.length !== 2 || !api?.encryptMessage || !api?.decryptMessage) {
    if (elements.errorMessage) elements.errorMessage.textContent = '页面资源不完整，请刷新后重试。';
    if (elements.submitButton) elements.submitButton.disabled = true;
    return;
  }

  const encoder = new TextEncoder();
  const reduceMotion = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const formatTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const formatDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short'
  });
  const formatTimestamp = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const state = {
    mode: 'encrypt', busy: false, clockTimer: 0, expiryTimer: 0, copyTimer: 0,
    expiresAt: 0, serverEpochMs: 0, monotonicAnchor: 0, synced: false, syncing: false
  };

  function announce(message) {
    elements.statusMessage.textContent = '';
    requestAnimationFrame(() => { elements.statusMessage.textContent = message; });
  }

  /**
   * 通过同源 HEAD 请求读取 CDN/静态服务器生成的 Date 响应头。往返时间的一半
   * 作为网络延迟近似补偿；之后只用 performance.now() 单调推进，不读取设备时间。
   * 如果响应头不可读或无效，页面会关闭加解密能力，绝不退回本机时钟。
   */
  async function syncServerTime({ quiet = false } = {}) {
    if (state.syncing) return state.synced;
    state.syncing = true;
    elements.syncButton.disabled = true;
    elements.timeStatus.textContent = '同步中';
    elements.timeStatus.dataset.state = 'pending';
    const started = performance.now();
    try {
      const url = new URL(location.href);
      url.hash = '';
      url.searchParams.set('_time_probe', crypto.getRandomValues(new Uint32Array(1))[0].toString(36));
      const response = await fetch(url, {
        method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'error'
      });
      const dateHeader = response.headers.get('Date');
      const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
      if (!response.ok || !Number.isFinite(parsed)) throw new Error('服务器未返回有效 Date 头');
      const finished = performance.now();
      state.serverEpochMs = parsed + ((finished - started) / 2);
      state.monotonicAnchor = finished;
      state.synced = true;
      elements.timeStatus.textContent = '服务器已校准';
      elements.timeStatus.dataset.state = 'ready';
      if (!quiet) announce('服务器时间同步成功');
      updateClock();
      return true;
    } catch {
      state.synced = false;
      elements.timeStatus.textContent = '同步失败';
      elements.timeStatus.dataset.state = 'error';
      elements.errorMessage.textContent = '无法获得服务器时间，已停止加解密。请检查网络后重试同步。';
      if (!quiet) announce(elements.errorMessage.textContent);
      return false;
    } finally {
      state.syncing = false;
      elements.syncButton.disabled = false;
      updateSubmitState();
    }
  }

  function serverNowMs() {
    if (!state.synced) return NaN;
    return state.serverEpochMs + (performance.now() - state.monotonicAnchor);
  }

  function serverNowSeconds() {
    const milliseconds = serverNowMs();
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : NaN;
  }

  function updateClock() {
    const milliseconds = serverNowMs();
    if (!Number.isFinite(milliseconds)) {
      elements.currentTime.textContent = '--:--:--';
      elements.currentDate.textContent = '等待服务器校时';
      elements.windowLabel.textContent = '校时成功后才能生成或验证密文';
      elements.minuteProgress.style.transform = 'scaleX(0)';
      return;
    }
    const date = new Date(milliseconds);
    const seconds = Math.floor(milliseconds / 1000) % 60;
    const progress = (milliseconds % 60000) / 60000;
    elements.currentTime.textContent = formatTime.format(date);
    elements.currentDate.textContent = `${formatDate.format(date)} · 中国标准时间`;
    elements.minuteProgress.style.transform = `scaleX(${progress})`;
    elements.windowLabel.textContent = `${60 - seconds} 秒后轮换分钟密钥`;
  }

  function scheduleClock() {
    clearTimeout(state.clockTimer);
    updateClock();
    state.clockTimer = setTimeout(scheduleClock, 1000 - (performance.now() % 1000));
  }

  function protectedModeSelected() {
    return elements.secretInput.value.length > 0;
  }

  // 提示内容是固定文案，也坚持用 DOM 节点写入，避免今后维护时误把用户输入拼进 HTML。
  function setModeNotice(title, description, className) {
    const strong = document.createElement('strong');
    const span = document.createElement('span');
    strong.textContent = title;
    span.textContent = description;
    elements.modeNotice.className = `mode-notice ${className}`;
    elements.modeNotice.replaceChildren(strong, span);
  }

  function updateSecretMeta() {
    const value = elements.secretInput.value;
    const characters = [...value].length;
    const bytes = encoder.encode(value).length;
    const convenience = !value;
    elements.secretMeta.className = '';
    elements.modeBadge.className = convenience ? 'mode-badge convenience' : 'mode-badge protected';
    elements.modeBadge.textContent = convenience ? '免口令便捷模式' : '口令保护模式';
    setModeNotice(
      convenience ? '无需口令，但不保密' : '口令参与密钥派生',
      convenience ? '任何拿到密文的人都能解开；仅适合低敏感临时内容。' : '接收方必须输入相同口令；页面不会上传或保存口令。',
      convenience ? 'warning' : 'secure'
    );
    if (convenience) {
      elements.secretMeta.textContent = '留空即可免口令解密';
    } else if (characters < api.MIN_SECRET_CHARACTERS) {
      elements.secretMeta.textContent = `还需 ${api.MIN_SECRET_CHARACTERS - characters} 个字符`;
      elements.secretMeta.className = 'is-danger';
    } else if (bytes > api.MAX_SECRET_BYTES) {
      elements.secretMeta.textContent = `已超过 ${api.MAX_SECRET_BYTES} 字节上限`;
      elements.secretMeta.className = 'is-danger';
    } else {
      elements.secretMeta.textContent = characters >= 16 ? '长度符合推荐 · 不会保存' : '可以使用 · 推荐 16+ 随机字符';
      elements.secretMeta.className = characters >= 16 ? 'is-ready' : '';
    }
    updateSubmitState();
  }

  function updateByteCount() {
    const count = encoder.encode(elements.plainInput.value).length;
    const invalid = count > api.MAX_MESSAGE_BYTES;
    elements.byteCount.textContent = `${count} / ${api.MAX_MESSAGE_BYTES} 字节`;
    elements.byteCount.classList.toggle('is-danger', invalid);
    elements.plainInput.setAttribute('aria-invalid', String(invalid));
  }

  function updateTokenInput({ format = true } = {}) {
    const metrics = api.inspectTokenInput(elements.tokenInput.value);
    if (format && metrics.validCharacters) elements.tokenInput.value = metrics.formatted;
    elements.tokenCount.textContent = `${metrics.rawLength} / ${api.TOKEN_RAW_LENGTH} 字符`;
    const invalid = !metrics.validCharacters || metrics.rawLength > api.TOKEN_RAW_LENGTH;
    elements.tokenCount.classList.toggle('is-danger', invalid);
    elements.tokenInput.setAttribute('aria-invalid', String(invalid));

    const version = api.inspectTokenVersion(elements.tokenInput.value);
    if (state.mode === 'decrypt' && version === api.CONVENIENCE_VERSION) {
      elements.modeBadge.textContent = '检测到免口令密文';
      elements.modeBadge.className = 'mode-badge convenience';
      setModeNotice('此密文不需要口令', '口令框可以留空；持有密文的任何人都能解开。', 'warning');
    } else if (state.mode === 'decrypt' && version && !protectedModeSelected()) {
      setModeNotice('此密文需要口令', '请输入发送方加密时使用的相同共享口令。', 'secure');
    }
  }

  function updateSubmitState() {
    const shortSecret = protectedModeSelected() && [...elements.secretInput.value].length < api.MIN_SECRET_CHARACTERS;
    elements.submitButton.disabled = state.busy || !state.synced || shortSecret;
    elements.clearButton.disabled = state.busy;
    elements.panel.setAttribute('aria-busy', String(state.busy));
    elements.buttonText.textContent = state.busy
      ? '正在安全计算…'
      : state.mode === 'encrypt' ? '生成一刻钟密文' : '验证并解密';
  }

  function stopExpiryCountdown() {
    clearTimeout(state.expiryTimer);
    state.expiryTimer = 0;
  }

  function updateExpiryCountdown() {
    const now = serverNowSeconds();
    if (!Number.isFinite(now)) {
      elements.expiryBadge.textContent = '等待校时';
      return;
    }
    const remaining = Math.max(0, state.expiresAt - now);
    if (!remaining) {
      elements.expiryBadge.textContent = '已停止验证';
      elements.expiryBadge.classList.add('expired');
      stopExpiryCountdown();
      return;
    }
    elements.expiryBadge.classList.remove('expired');
    elements.expiryBadge.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')} 后失效`;
    state.expiryTimer = setTimeout(updateExpiryCountdown, 1000);
  }

  function hideResult() {
    elements.resultBox.hidden = true;
    elements.resultText.textContent = '';
    state.expiresAt = 0;
    stopExpiryCountdown();
  }

  function renderResult(result, operation) {
    const encrypted = operation === 'encrypt';
    const convenience = result.mode === 'convenience';
    elements.resultTitle.textContent = encrypted ? '密文已生成' : '验证通过 · 解密结果';
    elements.resultText.textContent = encrypted ? result.token : result.message;
    elements.issuedAtTime.textContent = `签发 ${formatTimestamp.format(new Date(result.issuedAt * 1000))}`;
    elements.protocolBadge.textContent = `协议 v${result.version}`;
    elements.resultMode.textContent = convenience ? '免口令 · 不保密' : '口令保护';
    elements.resultMode.className = convenience ? 'convenience' : 'protected';
    elements.resultBox.hidden = false;
    state.expiresAt = result.issuedAt + api.MAX_AGE_SECONDS;
    updateExpiryCountdown();
    elements.resultBox.focus({ preventScroll: true });
    elements.resultBox.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    announce(encrypted ? '一刻钟密文已生成' : '密文验证通过，已显示解密结果');
  }

  function setMode(mode, focus = false) {
    if (state.busy || !['encrypt', 'decrypt'].includes(mode)) return;
    state.mode = mode;
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    elements.encryptFields.hidden = mode !== 'encrypt';
    elements.decryptFields.hidden = mode !== 'decrypt';
    elements.panel.setAttribute('aria-labelledby', mode === 'encrypt' ? 'encryptTab' : 'decryptTab');
    elements.errorMessage.textContent = '';
    hideResult();
    updateSecretMeta();
    updateTokenInput({ format: false });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
    tab.addEventListener('keydown', (event) => {
      const target = event.key === 'ArrowLeft' ? (index + 1) % 2
        : event.key === 'ArrowRight' ? (index + 1) % 2
        : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : -1;
      if (target < 0) return;
      event.preventDefault();
      setMode(tabs[target].dataset.mode, true);
    });
  });

  elements.secretInput.addEventListener('input', () => { updateSecretMeta(); updateTokenInput({ format: false }); });
  elements.plainInput.addEventListener('input', updateByteCount);
  elements.tokenInput.addEventListener('input', () => updateTokenInput());
  elements.syncButton.addEventListener('click', () => syncServerTime());
  elements.toggleSecret.addEventListener('click', () => {
    const show = elements.secretInput.type === 'password';
    elements.secretInput.type = show ? 'text' : 'password';
    elements.toggleSecret.setAttribute('aria-pressed', String(show));
    elements.toggleSecret.setAttribute('aria-label', show ? '隐藏口令' : '显示口令');
  });
  elements.clearButton.addEventListener('click', () => {
    elements.form.reset();
    elements.secretInput.type = 'password';
    elements.errorMessage.textContent = '';
    hideResult(); updateSecretMeta(); updateByteCount(); updateTokenInput({ format: false });
    (state.mode === 'encrypt' ? elements.plainInput : elements.tokenInput).focus();
    announce('输入和结果已从页面清除');
  });

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    elements.errorMessage.textContent = '';
    state.busy = true; updateSubmitState();
    try {
      // 每次敏感操作前重新校时，防止长时间打开页面后使用过旧的时间锚点。
      if (!await syncServerTime({ quiet: true })) throw new Error('无法获得服务器时间，操作已停止');
      const now = serverNowSeconds();
      const result = state.mode === 'encrypt'
        ? await api.encryptMessage(elements.secretInput.value, elements.plainInput.value, now)
        : await api.decryptMessage(elements.secretInput.value, elements.tokenInput.value, now);
      renderResult(result, state.mode);
    } catch (error) {
      elements.errorMessage.textContent = error instanceof Error ? error.message : '操作失败，请检查输入后重试';
      hideResult(); announce(elements.errorMessage.textContent);
    } finally {
      state.busy = false; updateSubmitState();
    }
  });

  elements.copyButton.addEventListener('click', async () => {
    const text = elements.resultText.textContent;
    if (!text) return;
    clearTimeout(state.copyTimer);
    try {
      await navigator.clipboard.writeText(text);
      elements.copyButtonText.textContent = '已复制';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(elements.resultText);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      elements.copyButtonText.textContent = '已选中，请按 Ctrl+C';
    }
    state.copyTimer = setTimeout(() => { elements.copyButtonText.textContent = '复制结果'; }, 2200);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncServerTime({ quiet: true });
  });
  addEventListener('pagehide', () => {
    clearTimeout(state.clockTimer); clearTimeout(state.copyTimer); stopExpiryCountdown();
  });

  setMode('encrypt'); updateByteCount(); updateTokenInput({ format: false });
  scheduleClock(); syncServerTime({ quiet: true });
})();

