const { MAX_AGE_SECONDS, MAX_MESSAGE_BYTES, encryptMessage, decryptMessage } = globalThis.TimeCrypto;

const encoder = new TextEncoder();
const $ = (id) => document.getElementById(id);
const state = { mode: 'encrypt', expiresAt: 0, expiryTimer: null };

/** 更新当前时间和本分钟进度；该时钟仅用于界面提示，不负责密码判断。 */
function updateClock() {
  const now = new Date();
  $('currentTime').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  $('minuteProgress').style.width = `${((now.getSeconds() * 1000 + now.getMilliseconds()) / 60000) * 100}%`;
  $('windowLabel').textContent = `${60 - now.getSeconds()}s 后换钥`;
}

function updateByteCount() {
  const count = encoder.encode($('plainInput').value).length;
  $('byteCount').textContent = `${count} / ${MAX_MESSAGE_BYTES} 字节`;
  $('byteCount').style.color = count > MAX_MESSAGE_BYTES ? '#ff8a7a' : '';
}

/** 在加密/解密两种表单之间切换，并清理上一次操作结果。 */
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('encryptFields').hidden = mode !== 'encrypt';
  $('decryptFields').hidden = mode !== 'decrypt';
  $('buttonText').textContent = mode === 'encrypt' ? '生成一刻钟密文' : '验证并解密';
  $('resultBox').hidden = true;
  $('errorMessage').textContent = '';
}

function startExpiryCountdown(issuedAt) {
  clearInterval(state.expiryTimer);
  state.expiresAt = (issuedAt + MAX_AGE_SECONDS) * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    $('expiryBadge').textContent = remaining ? `${minutes}:${seconds} 后失效` : '已失效';
  };
  tick();
  state.expiryTimer = setInterval(tick, 1000);
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('plainInput').addEventListener('input', updateByteCount);
$('toggleSecret').addEventListener('click', () => {
  const input = $('secretInput');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('toggleSecret').setAttribute('aria-label', input.type === 'password' ? '显示口令' : '隐藏口令');
});

$('cipherForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('errorMessage').textContent = '';
  const secret = $('secretInput').value;
  if (secret.length < 8) { $('errorMessage').textContent = '共享口令至少需要 8 位'; return; }
  const button = $('submitButton');
  button.disabled = true;
  $('buttonText').textContent = '正在计算…';
  try {
    // 密码操作统一由 crypto-core.mjs 提供，界面层不复制算法实现。
    const result = state.mode === 'encrypt'
      ? await encryptMessage(secret, $('plainInput').value)
      : await decryptMessage(secret, $('tokenInput').value);
    $('resultTitle').textContent = state.mode === 'encrypt' ? '密文已生成' : '验证通过 · 解密结果';
    $('resultText').textContent = state.mode === 'encrypt' ? result.token : result.message;
    $('resultBox').hidden = false;
    startExpiryCountdown(result.issuedAt);
  } catch (error) {
    $('errorMessage').textContent = error.message || '操作失败，请检查输入';
    $('resultBox').hidden = true;
  } finally {
    button.disabled = false;
    $('buttonText').textContent = state.mode === 'encrypt' ? '生成一刻钟密文' : '验证并解密';
  }
});

$('copyButton').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('resultText').textContent);
    $('copyButton').querySelector('span').textContent = '已复制';
    setTimeout(() => { $('copyButton').querySelector('span').textContent = '复制结果'; }, 1500);
  } catch {
    $('errorMessage').textContent = '浏览器禁止读取剪贴板，请手动复制';
  }
});

updateByteCount();
updateClock();
// 高频率只用于让分钟进度条平滑移动；派生密钥仍按整分钟变化。
setInterval(updateClock, 250);
