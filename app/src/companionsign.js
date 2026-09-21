// Signing in to a broker with the companion's own key (#554).
//
// Some brokers take no password: the client proves which MeshCore node it is
// with a token signed by that node's Ed25519 key. The companion signs it
// itself, so the private key never leaves the radio.
//
// Frame layout from the firmware, examples/companion_radio/MyMesh.cpp:
//   CMD_SIGN_START  [33]              -> [19][0][max_len uint32 LE]
//   CMD_SIGN_DATA   [34][bytes...]    -> [0] (OK) or [1][err]
//   CMD_SIGN_FINISH [35]              -> [20][signature x64]
// The companion buffers every DATA frame and signs the whole buffer on FINISH.

const CMD_SIGN_START = 33;
const CMD_SIGN_DATA = 34;
const CMD_SIGN_FINISH = 35;
const RESP_OK = 0;
const RESP_ERR = 1;
const RESP_SIGN_START = 19;
const RESP_SIGNATURE = 20;

// Data bytes per DATA frame. The companion takes a whole frame in one write and
// a frame is at most MAX_FRAME_SIZE (176, src/helpers/BaseSerialInterface.h);
// 128 plus the command byte stays well inside it.
export const SIGN_CHUNK = 128;

// exchange sends one frame and resolves with the first reply whose code is one
// of `accept`. An error frame rejects; so does silence, which is what firmware
// without the sign commands answers.
function exchange(transport, frame, accept, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onFrame = (dv) => {
      const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (b[0] === RESP_ERR) { cleanup(); reject(new Error('companion refused to sign (error ' + b[1] + ')')); return; }
      if (!accept.includes(b[0])) return;
      cleanup();
      resolve(b);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('companion did not answer the sign request')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); transport.offFrame(onFrame); }
    transport.onFrame(onFrame);
    transport.send(frame).catch((e) => { cleanup(); reject(e); });
  });
}

// signWithCompanion returns the 64-byte Ed25519 signature of `bytes`.
export async function signWithCompanion(transport, bytes, { timeoutMs = 8000 } = {}) {
  const started = await exchange(transport, new Uint8Array([CMD_SIGN_START]), [RESP_SIGN_START], timeoutMs);
  const maxLen = new DataView(started.buffer, started.byteOffset, started.byteLength).getUint32(2, true);
  if (bytes.length > maxLen) throw new Error('too long for the companion to sign: ' + bytes.length + ' bytes, limit ' + maxLen);
  for (let i = 0; i < bytes.length; i += SIGN_CHUNK) {
    const part = bytes.subarray(i, i + SIGN_CHUNK);
    const frame = new Uint8Array(1 + part.length);
    frame[0] = CMD_SIGN_DATA;
    frame.set(part, 1);
    await exchange(transport, frame, [RESP_OK], timeoutMs);
  }
  const done = await exchange(transport, new Uint8Array([CMD_SIGN_FINISH]), [RESP_SIGNATURE], timeoutMs);
  if (done.length < 65) throw new Error('companion returned a short signature');
  return done.slice(1, 65);
}

const b64url = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toHex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');

// How long a token stays valid. A reconnect inside that window reuses it, so
// the radio is asked to sign once a day rather than on every dropped socket.
export const TOKEN_TTL_S = 86400;

// buildBrokerToken assembles header.payload.signature. `sign` is
// (bytes) => Promise<Uint8Array(64)>; the signature travels as hex.
export async function buildBrokerToken({ pubkeyHex, audience, nowSec, sign }) {
  const header = { alg: 'Ed25519', typ: 'JWT' };
  const payload = { publicKey: String(pubkeyHex).toUpperCase(), aud: audience, iat: nowSec, exp: nowSec + TOKEN_TTL_S };
  const input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = await sign(new TextEncoder().encode(input));
  if (!sig || sig.length !== 64) throw new Error('expected a 64-byte signature');
  return input + '.' + toHex(sig);
}

export function brokerUsername(pubkeyHex) {
  return 'v1_' + String(pubkeyHex).toUpperCase();
}

// The audience a broker checks is the host the client connected to.
export function brokerAudience(url) {
  return new URL(url).hostname;
}

// createSigner returns a sign function that runs one signature at a time. The
// companion has a single sign buffer and a second START empties it, so two
// brokers that both need a token must not interleave their frames.
export function createSigner(transport, opts) {
  let last = Promise.resolve();
  return (bytes) => {
    const run = last.then(() => signWithCompanion(transport, bytes, opts));
    last = run.catch(() => {});
    return run;
  };
}

// How much life a stored token must have left to be used for a connection. A
// token that expires mid-reconnect fails at the broker with nothing to show
// for it; asking the radio a few minutes early costs one signature.
export const TOKEN_MARGIN_S = 600;

// tokenUsable decides whether a stored token still signs this companion in to
// this host.
export function tokenUsable(token, { pubkeyHex, audience, nowSec }) {
  let claims = null;
  try {
    const part = String(token || '').split('.')[1] || '';
    claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (_) { return false; }
  if (!claims || claims.publicKey !== String(pubkeyHex).toUpperCase() || claims.aud !== audience) return false;
  return Number.isFinite(claims.exp) && claims.exp - nowSec > TOKEN_MARGIN_S;
}
