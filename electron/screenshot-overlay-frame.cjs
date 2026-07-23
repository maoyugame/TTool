const OVERLAY_FRAME_CHANNEL = 'screenshot:overlay-frame'
const OVERLAY_FRAME_READY_EXPRESSION = 'window.__ttoolOverlayFrameReady'

// 浮层页面先完成小型 HTML 导航，再通过 preload 接收 PNG 二进制并创建短 Blob URL。
// 这样全屏图片大小不会再计入 Chromium 的顶层 URL 长度限制。
function overlayFrameReceiverScript() {
  return String.raw`
const frozenFrame = document.getElementById('frozenFrame');
let frozenFrameObjectUrl = '';
let disposeOverlayFrameListener = () => {};
window.__ttoolOverlayFrameReady = new Promise((resolve, reject) => {
  let settled = false;
  const finish = (ok, value) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    disposeOverlayFrameListener();
    if (ok) resolve(value);
    else reject(value);
  };
  const timeout = window.setTimeout(() => finish(false, new Error('截图画面加载超时')), 15000);
  const api = window.ttool && window.ttool.screenshot;
  if (!frozenFrame || !api || typeof api.onOverlayFrame !== 'function') {
    finish(false, new Error('截图画面桥接不可用'));
    return;
  }
  disposeOverlayFrameListener = api.onOverlayFrame((payload) => {
    if (!payload || String(payload.captureId) !== String(META.captureId) || Number(payload.displayId) !== Number(META.displayId)) return;
    try {
      const raw = payload.png;
      let bytes = null;
      if (raw instanceof Uint8Array) bytes = raw;
      else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
      else if (raw && raw.buffer instanceof ArrayBuffer) bytes = new Uint8Array(raw.buffer, Number(raw.byteOffset) || 0, Number(raw.byteLength) || 0);
      else if (raw && Array.isArray(raw.data)) bytes = new Uint8Array(raw.data);
      if (!bytes || !bytes.byteLength) throw new Error('截图画面为空');
      if (frozenFrameObjectUrl) URL.revokeObjectURL(frozenFrameObjectUrl);
      frozenFrameObjectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      frozenFrame.onload = () => finish(true, {
        width: frozenFrame.naturalWidth,
        height: frozenFrame.naturalHeight,
        byteLength: bytes.byteLength,
        source: 'blob',
      });
      frozenFrame.onerror = () => finish(false, new Error('截图画面解码失败'));
      frozenFrame.src = frozenFrameObjectUrl;
    } catch (error) {
      finish(false, error instanceof Error ? error : new Error('截图画面加载失败'));
    }
  });
});
window.addEventListener('beforeunload', () => {
  disposeOverlayFrameListener();
  if (frozenFrameObjectUrl) URL.revokeObjectURL(frozenFrameObjectUrl);
});
`
}

function overlayNavigationUrl(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(String(html || ''))
}

function loadOverlayWithFrame(overlay, html, payload) {
  const navigationUrl = overlayNavigationUrl(html)
  const ready = overlay.loadURL(navigationUrl).then(async () => {
    overlay.webContents.send(OVERLAY_FRAME_CHANNEL, payload)
    const frame = await overlay.webContents.executeJavaScript(OVERLAY_FRAME_READY_EXPRESSION, true)
    return { ...frame, navigationUrlLength: navigationUrl.length }
  })
  return { ready, navigationUrlLength: navigationUrl.length }
}

module.exports = {
  OVERLAY_FRAME_CHANNEL,
  loadOverlayWithFrame,
  overlayFrameReceiverScript,
  overlayNavigationUrl,
}
