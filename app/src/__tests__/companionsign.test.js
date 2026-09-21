import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { verifyAuthToken } from '@michaelhart/meshcore-decoder'
import { signWithCompanion, buildBrokerToken, brokerUsername, brokerAudience, SIGN_CHUNK, createSigner, tokenUsable } from '../companionsign.js'

const hex = (b) => Buffer.from(b).toString('hex')

// A companion as the firmware behaves (examples/companion_radio/MyMesh.cpp,
// CMD_SIGN_START / CMD_SIGN_DATA / CMD_SIGN_FINISH): it buffers what it is
// sent and signs the buffer with its own Ed25519 key on FINISH.
function fakeCompanion({ maxLen = 8192, failData = false, silent = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  let listeners = []
  let buf = null
  const sent = []
  const reply = (bytes) => { const u = new Uint8Array(bytes); queueMicrotask(() => listeners.forEach((f) => f(new DataView(u.buffer)))) }
  return {
    pubkeyHex: hex(pub),
    sent,
    listenerCount: () => listeners.length,
    onFrame(f) { listeners.push(f) },
    offFrame(f) { listeners = listeners.filter((x) => x !== f) },
    async send(frame) {
      sent.push(Array.from(frame))
      if (silent) return
      if (frame[0] === 33) { buf = []; const r = new Uint8Array(6); r[0] = 19; new DataView(r.buffer).setUint32(2, maxLen, true); reply(r) }
      else if (frame[0] === 34) { if (failData) return reply([1, 3]); buf.push(...frame.subarray(1)); reply([0]) }
      else if (frame[0] === 35) { reply([20, ...edSign(null, Buffer.from(buf), privateKey)]) }
    },
  }
}

describe('signWithCompanion — the companion signs, the key stays on it (#554)', () => {
  it('returns a signature that verifies against the companion\'s own key', async () => {
    const c = fakeCompanion()
    const token = await buildBrokerToken({ pubkeyHex: c.pubkeyHex, audience: 'broker.example', nowSec: 1_790_000_000, sign: (b) => signWithCompanion(c, b) })
    const claims = await verifyAuthToken(token, c.pubkeyHex.toUpperCase())
    expect(claims).toMatchObject({ publicKey: c.pubkeyHex.toUpperCase(), aud: 'broker.example', iat: 1_790_000_000 })
  })

  it('sends the data in frames the companion can take, in order', async () => {
    const c = fakeCompanion()
    const data = new Uint8Array(SIGN_CHUNK * 2 + 5).map((_, i) => i % 251)
    await signWithCompanion(c, data)
    const dataFrames = c.sent.filter((f) => f[0] === 34)
    expect(dataFrames.map((f) => f.length - 1)).toEqual([SIGN_CHUNK, SIGN_CHUNK, 5])
    expect(dataFrames.flatMap((f) => f.slice(1))).toEqual(Array.from(data))
    expect(c.sent[0]).toEqual([33])
    expect(c.sent[c.sent.length - 1]).toEqual([35])
  })

  it('refuses data the companion says it cannot hold, before sending any of it', async () => {
    const c = fakeCompanion({ maxLen: 10 })
    await expect(signWithCompanion(c, new Uint8Array(11))).rejects.toThrow(/too long/)
    expect(c.sent.filter((f) => f[0] === 34)).toEqual([])
  })

  it('stops on an error frame and stops listening', async () => {
    const c = fakeCompanion({ failData: true })
    await expect(signWithCompanion(c, new Uint8Array(4))).rejects.toThrow(/refused/)
    expect(c.listenerCount()).toBe(0)
  })

  // Firmware without the sign commands answers nothing at all.
  it('gives up on a companion that does not answer, and stops listening', async () => {
    const c = fakeCompanion({ silent: true })
    await expect(signWithCompanion(c, new Uint8Array(4), { timeoutMs: 20 })).rejects.toThrow(/did not answer/)
    expect(c.listenerCount()).toBe(0)
  })
})

describe('broker sign-in fields (#554)', () => {
  it('builds the username the broker expects from the companion key', () => {
    expect(brokerUsername('ab'.repeat(32))).toBe('v1_' + 'AB'.repeat(32))
  })

  it('takes the audience from the host the app connects to, without the port', () => {
    expect(brokerAudience('wss://collector.example:8443/mqtt')).toBe('collector.example')
  })

  it('keeps a token valid for a day', async () => {
    const c = fakeCompanion()
    const token = await buildBrokerToken({ pubkeyHex: c.pubkeyHex, audience: 'x', nowSec: 1000, sign: (b) => signWithCompanion(c, b) })
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(claims.exp - claims.iat).toBe(86400)
  })
})

describe('createSigner — one signature at a time (#554)', () => {
  // The companion has a single sign buffer, and a second START empties it. Two
  // brokers that both need a token must not interleave their frames.
  it('finishes one signature before it starts the next', async () => {
    const c = fakeCompanion()
    const sign = createSigner(c)
    const a = new Uint8Array(SIGN_CHUNK + 1).fill(1)
    const b = new Uint8Array(3).fill(2)
    await Promise.all([sign(a), sign(b)])
    expect(c.sent.map((f) => f[0])).toEqual([33, 34, 34, 35, 33, 34, 35])
  })

  it('carries on with the next signature after one fails', async () => {
    const c = fakeCompanion({ maxLen: 4 })
    const sign = createSigner(c)
    const first = sign(new Uint8Array(9))
    const second = sign(new Uint8Array(2))
    await expect(first).rejects.toThrow(/too long/)
    expect((await second).length).toBe(64)
  })
})

describe('tokenUsable — when a stored token still gets in (#554)', () => {
  const token = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig'
  const KEY = 'AB'.repeat(32)

  it('accepts a token for this companion and this host that has time left', () => {
    expect(tokenUsable(token({ publicKey: KEY, aud: 'b.example', exp: 5000 }), { pubkeyHex: KEY.toLowerCase(), audience: 'b.example', nowSec: 1000 })).toBe(true)
  })

  it('refuses one that is about to expire, so a reconnect is not the moment it fails', () => {
    expect(tokenUsable(token({ publicKey: KEY, aud: 'b.example', exp: 1200 }), { pubkeyHex: KEY, audience: 'b.example', nowSec: 1000 })).toBe(false)
  })

  it('refuses a token signed by another companion or for another host', () => {
    expect(tokenUsable(token({ publicKey: 'CD'.repeat(32), aud: 'b.example', exp: 5000 }), { pubkeyHex: KEY, audience: 'b.example', nowSec: 1000 })).toBe(false)
    expect(tokenUsable(token({ publicKey: KEY, aud: 'other.example', exp: 5000 }), { pubkeyHex: KEY, audience: 'b.example', nowSec: 1000 })).toBe(false)
  })

  it('refuses anything that is not a token', () => {
    expect(tokenUsable('', { pubkeyHex: KEY, audience: 'b.example', nowSec: 1000 })).toBe(false)
    expect(tokenUsable('a.%%%.c', { pubkeyHex: KEY, audience: 'b.example', nowSec: 1000 })).toBe(false)
  })
})
