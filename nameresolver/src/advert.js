import { PayloadType } from '@michaelhart/meshcore-decoder'

const HEX_PUBKEY = /^[0-9a-f]{64}$/

// extractAdvert maps a decoded packet to {pubkey,name,lat,lon} when it is an
// advert that carries a name. Returns null otherwise. Location is null unless
// the advert included one. How the advert reached us (hops/direction) is
// irrelevant — we only want the name binding.
export function extractAdvert(decoded) {
  if (!decoded || decoded.payloadType !== PayloadType.Advert) return null
  const p = decoded.payload?.decoded
  if (!p || !p.appData || !p.appData.hasName) return null

  const name = typeof p.appData.name === 'string' ? p.appData.name.trim() : ''
  if (!name) return null

  const pubkey = String(p.publicKey || '').toLowerCase()
  if (!HEX_PUBKEY.test(pubkey)) return null

  let lat = null
  let lon = null
  if (p.appData.hasLocation && p.appData.location) {
    lat = typeof p.appData.location.latitude === 'number' ? p.appData.location.latitude : null
    lon = typeof p.appData.location.longitude === 'number' ? p.appData.location.longitude : null
  }
  return { pubkey, name, lat, lon }
}
