(() => {
  'use strict';

  const api = globalThis.TimeCrypto;
  const byId = (id) => document.getElementById(id);
  const elements = {
    cipherForm: byId('cipherForm'),
    cipherPanel: byId('cipherPanel'),
    currentDate: byId('currentDate'),
    currentTime: byId('currentTime'),
    minuteProgress: byId('minuteProgress'),
    windowLabel: byId('windowLabel'),
    secretInput: byId('secretInput'),
    secretMeta: byId('secretMeta'),
    toggleSecret: byId('toggleSecret'),
    plainInput: byId('plainInput'),
    byteCount: byId('byteCount'),
    tokenInput: byId('tokenInput'),
    tokenCount: byId('tokenCount'),
    encryptFields: byId('encryptFields'),
    decryptFields: byId('decryptFields'),
    submitButton: byId('submitButton'),
    clearButton: byId('clearButton'),
    buttonText: byId('buttonText'),
    errorMessage: byId('errorMessage'),
    statusMessage: byId('statusMessage'),
    resultBox: byId('resultBox'),
    resultTitle: byId('resultTitle'),
    resultText: byId('resultText'),
    expiryBadge: byId('expiryBadge'),
    issuedAtTime: byId('issuedAtTime'),
    protocolBadge: byId('protocolBadge'),
    copyButton: byId('copyButton'),
    copyButtonText: byId('copyButtonText')
  };
  const tabs = [...document.querySelectorAll('[role="tab"]')];

  // 静态站点发布时 HTML/JS 可能短暂命中不同缓存版本；用可读提示替代空节点崩溃。
  const missingElementIds = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([id]) => id);
  const apiReady = api
    && typeof api.encryptMessage === 'function'
    && typeof api.decryptMessage === 'function'
    && typeof api.inspectTokenInput === 'function'
    && Number.isInteger(api.PROTOCOL_VERSION);
  if (missingElementIds.length || tabs.length !== 2 || !apiReady) {
    const fallback = byId('errorMessage');
    if (fallback) fallback.textContent = '页面资源正在更新，请刷新后重试';
    const submit = byId('submitButton');
    if (submit) submit.disabled = true;
    return;
  }

  const encoder = new TextEncoder();
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  });
  const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const state = {
    mode: 'encrypt',
    busy: false,
    expiresAt: 0,
    expiryTimer: 0,
    clockTimer: 0,
    copyTimer: 0
  };

  function announce(message) {
    elements.statusMessage.textContent = '';
    requestAnimationFrame(() => { elements.statusMessage.textContent = message; });
  }

  /** 当前时钟只解释本机时间窗口，不声称与服务器同步。 */
  function updateClock() {
    const now = new Date();
    const minuteProgress = (now.getSeconds() * 1000 + now.getMilliseconds()) / 60000;
    elements.currentDate.textContent = dateFormatter.format(now);
    elements.currentTime.textContent = timeFormatter.format(now);
    elements.minuteProgress.style.transform = `scaleX(${minuteProgress})`;
    elements.windowLabel.textContent = `${60 - now.getSeconds()} 秒后进入下一分钟密钥窗口`;
  }

  /** 与整秒边界对齐，并把原来的 4Hz DOM 更新降为 1Hz。 */
  function scheduleClock() {
    clearTimeout(state.clockTimer);
    updateClock();
    state.clockTimer = setTimeout(scheduleClock, 1020 - (Date.now() % 1000));
  }

  function updateSecretMeta() {
    const value = elements.secretInput.value;
    const characters = [...value].length;
    const bytes = encoder.encode(value).length;
    elements.secretMeta.classList.remove('is-danger', 'is-ready');

    if (!value) {
      elements.secretMeta.textContent = `至少 ${api.MIN_SECRET_CHARACTERS} 字符 · 建议 16+ 随机字符`;
    } else if (characters < api.MIN_SECRET_CHARACTERS) {
      elements.secretMeta.textContent = `还需 ${api.MIN_SECRET_CHARACTERS - characters} 个字符`;
      elements.secretMeta.classList.add('is-danger');
    } else if (bytes > api.MAX_SECRET_BYTES) {
      elements.secretMeta.textContent = `已超过 ${api.MAX_SECRET_BYTES} 字节上限`;
      elements.secretMeta.classList.add('is-danger');
    } else if (characters < 16) {
      elements.secretMeta.textContent = '可以使用，但建议增加到 16+ 随机字符';
    } else {
      elements.secretMeta.textContent = '长度符合推荐 · 不会被保存';
      elements.secretMeta.classList.add('is-ready');
    }
  }

  function updateByteCount() {
    const count = encoder.encode(elements.plainInput.value).length;
    const invalid = count > api.MAX_MESSAGE_BYTES;
    elements.byteCount.textContent = `${count} / ${api.MAX_MESSAGE_BYTES} 字节`;
    elements.byteCount.classList.toggle('is-danger', invalid);
    elements.plainInput.setAttribute('aria-invalid', String(invalid));
  }

  /** 密文的清理和分组规则来自密码核心，界面层不复制协议常量。 */
  function updateTokenInput({ format = true } = {}) {
    const input = elements.tokenInput;
    const selectionStart = input.selectionStart ?? input.value.length;
    const prefixMetrics = api.inspectTokenInput(input.value.slice(0, selectionStart));
    const metrics = api.inspectTokenInput(input.value);

    if (format && input.value !== metrics.formatted) {
      const totalRaw = metrics.rawLength;
      const prefixRaw = prefixMetrics.rawLength;
      let cursor = prefixMetrics.formatted.length;
      if (prefixRaw > 0 && prefixRaw % api.TOKEN_GROUP_SIZE === 0 && totalRaw > prefixRaw) cursor += 1;
      input.value = metrics.formatted;
      input.setSelectionRange(Math.min(cursor, input.value.length), Math.min(cursor, input.value.length));
    }

    const invalid = !metrics.validCharacters || metrics.rawLength > api.TOKEN_RAW_LENGTH;
    elements.tokenCount.textContent = `${metrics.rawLength} / ${api.TOKEN_RAW_LENGTH} 字符`;
    elements.tokenCount.classList.toggle('is-danger', invalid);
    input.setAttribute('aria-invalid', String(invalid));
  }

  function stopExpiryCountdown() {
    clearInterval(state.expiryTimer);
    state.expiryTimer = 0;
    state.expiresAt = 0;
  }

  function updateExpiryCountdown() {
    const remaining = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    elements.expiryBadge.textContent = remaining ? `${minutes}:${seconds} 后停止验证` : '验证窗口已结束';
    elements.resultBox.classList.toggle('is-expired', remaining === 0);

    if (remaining === 0 && state.expiryTimer) {
      clearInterval(state.expiryTimer);
      state.expiryTimer = 0;
      announce('这条结果的一刻钟验证窗口已经结束');
    }
  }

  function startExpiryCountdown(issuedAt) {
    stopExpiryCountdown();
    state.expiresAt = (issuedAt + api.MAX_AGE_SECONDS) * 1000;
    updateExpiryCountdown();
    if (state.expiresAt > Date.now()) state.expiryTimer = setInterval(updateExpiryCountdown, 1000);
  }

  function hideResult() {
    stopExpiryCountdown();
    elements.resultBox.hidden = true;
    elements.resultBox.classList.remove('is-expired');
    elements.resultText.textContent = '';
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.cipherPanel.setAttribute('aria-busy', String(busy));
    elements.submitButton.disabled = busy;
    elements.clearButton.disabled = busy;
    tabs.forEach((tab) => { tab.disabled = busy; });
    elements.buttonText.textContent = busy
      ? '正在安全计算…'
      : state.mode === 'encrypt' ? '生成一刻钟密文' : '验证并解密';
  }

  /** 切换模式时清除上次敏感结果，避免把旧结果误认为当前操作的输出。 */
  function setMode(mode, { focusTab = false } = {}) {
    if (state.busy || !['encrypt', 'decrypt'].includes(mode)) return;
    state.mode = mode;
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    elements.encryptFields.hidden = mode !== 'encrypt';
    elements.decryptFields.hidden = mode !== 'decrypt';
    elements.cipherPanel.setAttribute('aria-labelledby', mode === 'encrypt' ? 'encryptTab' : 'decryptTab');
    elements.errorMessage.textContent = '';
    elements.buttonText.textContent = mode === 'encrypt' ? '生成一刻钟密文' : '验证并解密';
    hideResult();
  }

  function clearSensitiveData({ focus = true, announceChange = true } = {}) {
    elements.cipherForm.reset();
    elements.secretInput.type = 'password';
    elements.toggleSecret.setAttribute('aria-pressed', 'false');
    elements.toggleSecret.setAttribute('aria-label', '显示口令');
    elements.toggleSecret.classList.remove('is-active');
    elements.errorMessage.textContent = '';
    hideResult();
    updateSecretMeta();
    updateByteCount();
    updateTokenInput({ format: false });
    if (focus) elements.secretInput.focus();
    if (announceChange) announce('口令、输入和结果已从当前页面清除');
  }

  function renderResult(result, operationMode) {
    const isEncryption = operationMode === 'encrypt';
    elements.resultTitle.textContent = isEncryption ? '密文已生成' : '认证通过 · 解密结果';
    elements.resultText.textContent = isEncryption ? result.token : result.message;
    elements.resultText.setAttribute('aria-label', isEncryption ? '生成的密文' : '解密后的明文');
    elements.issuedAtTime.textContent = `签发 ${timestampFormatter.format(new Date(result.issuedAt * 1000))}`;
    elements.protocolBadge.textContent = `协议 v${result.version}`;
    elements.resultBox.hidden = false;
    startExpiryCountdown(result.issuedAt);
    elements.resultBox.focus({ preventScroll: true });
    elements.resultBox.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest'
    });
    announce(isEncryption ? '一刻钟密文已生成' : '密文验证通过，已显示解密结果');
  }

  tabs.forEach((tab, tabIndex) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
    tab.addEventListener('keydown', (event) => {
      const keyTargets = {
        ArrowLeft: (tabIndex - 1 + tabs.length) % tabs.length,
        ArrowRight: (tabIndex + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (!(event.key in keyTargets)) return;
      event.preventDefault();
      setMode(tabs[keyTargets[event.key]].dataset.mode, { focusTab: true });
    });
  });

  elements.secretInput.addEventListener('input', updateSecretMeta);
  elements.plainInput.addEventListener('input', updateByteCount);
  elements.tokenInput.addEventListener('input', () => updateTokenInput());
  elements.tokenInput.addEventListener('blur', () => updateTokenInput());

  elements.toggleSecret.addEventListener('click', () => {
    const reveal = elements.secretInput.type === 'password';
    elements.secretInput.type = reveal ? 'text' : 'password';
    elements.toggleSecret.setAttribute('aria-pressed', String(reveal));
    elements.toggleSecret.setAttribute('aria-label', reveal ? '隐藏口令' : '显示口令');
    elements.toggleSecret.classList.toggle('is-active', reveal);
  });

  elements.clearButton.addEventListener('click', () => clearSensitiveData());

  elements.cipherForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;

    const operationMode = state.mode;
    const secret = elements.secretInput.value;
    const payload = operationMode === 'encrypt'
      ? elements.plainInput.value
      : elements.tokenInput.value;
    elements.errorMessage.textContent = '';
    setBusy(true);

    try {
      // 模式和输入在 await 前被快照，异步完成后不会受标签切换影响。
      const result = operationMode === 'encrypt'
        ? await api.encryptMessage(secret, payload)
        : await api.decryptMessage(secret, payload);
      renderResult(result, operationMode);
    } catch (error) {
      elements.errorMessage.textContent = error instanceof Error
        ? error.message
        : '操作失败，请检查输入后重试';
      hideResult();
      announce(elements.errorMessage.textContent);
    } finally {
      setBusy(false);
    }
  });

  elements.copyButton.addEventListener('click', async () => {
    const text = elements.resultText.textContent;
    if (!text) return;
    clearTimeout(state.copyTimer);

    try {
      if (!navigator.clipboard || !globalThis.isSecureContext) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      elements.copyButtonText.textContent = '已复制到剪贴板';
      announce('结果已复制到剪贴板');
    } catch {
      const selection = globalThis.getSelection();
      const range = document.createRange();
      range.selectNodeContents(elements.resultText);
      selection.removeAllRanges();
      selection.addRange(range);
      elements.resultText.focus();
      elements.copyButtonText.textContent = '已选中，请按 Ctrl+C';
      announce('浏览器未开放剪贴板，结果已选中，请手动复制');
    }

    state.copyTimer = setTimeout(() => {
      elements.copyButtonText.textContent = '复制结果';
    }, 2200);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateClock();
      if (state.expiresAt) updateExpiryCountdown();
    }
  });

  globalThis.addEventListener('pagehide', () => {
    clearTimeout(state.clockTimer);
    clearTimeout(state.copyTimer);
    stopExpiryCountdown();
  });

  setMode('encrypt');
  updateSecretMeta();
  updateByteCount();
  updateTokenInput({ format: false });
  scheduleClock();
})();

