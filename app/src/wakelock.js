// Keep the screen awake while capturing. Generic across browsers: use the native
// Screen Wake Lock API where available (Chrome Android/desktop, Safari 16.4+ tab),
// and fall back to a hidden muted looping <video> (the "NoSleep" trick) where it
// isn't (e.g. Bluefy / WKWebView on iOS). The native sentinel is auto-released when
// the page is hidden, so it is re-acquired on visibilitychange.
//
// navigator/document are injectable so the native-vs-fallback selection is unit
// testable without a real browser.
import { webm, mp4 } from './wakelock-media.js';

export function createWakeLock(deps = {}) {
  const nav = deps.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : undefined);
  const native = !!(nav && nav.wakeLock);

  let active = false;  // the caller wants the screen kept awake
  let sentinel = null; // native WakeLockSentinel
  let video = null;    // fallback <video>

  async function acquireNative() {
    try {
      sentinel = await nav.wakeLock.request('screen');
    } catch (e) {
      // request can reject (e.g. document not visible) — use the video instead.
      startVideo();
    }
  }

  function ensureVideo() {
    if (video || !doc) return;
    video = doc.createElement('video');
    video.setAttribute('muted', '');
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('loop', '');
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    const addSrc = (type, data) => {
      const s = doc.createElement('source');
      s.type = type;
      s.src = data;
      video.appendChild(s);
    };
    addSrc('video/webm', webm);
    addSrc('video/mp4', mp4);
    doc.body.appendChild(video);
  }

  function startVideo() {
    ensureVideo();
    if (video && video.play) {
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  function onVisible() {
    // The OS releases the native sentinel when the page hides; re-acquire on return.
    if (active && native && doc && doc.visibilityState === 'visible') acquireNative();
  }

  async function enable() {
    if (active) return; // idempotent — don't stack locks
    active = true;
    if (native) {
      if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisible);
      await acquireNative();
    } else {
      startVideo();
    }
  }

  async function disable() {
    if (!active) return; // no-op when not enabled
    active = false;
    if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisible);
    if (sentinel) { try { await sentinel.release(); } catch (e) {} sentinel = null; }
    if (video && video.pause) { try { video.pause(); } catch (e) {} }
  }

  return { enable, disable };
}
