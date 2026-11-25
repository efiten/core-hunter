// Regenerates classify_app.json: the app's own classification of real frames,
// the expected values for classify_test.go (#735). It runs the capture path of
// app/src/app.js processFrame up to the identity gate, with no channel keys,
// because the server holds none.
//
//   node server/internal/meshpacket/testdata/gen-classify.mjs raws.json > server/internal/meshpacket/testdata/classify_app.json
//
// raws.json is a JSON array of raw frame hex strings. Needs `npm ci` in app/.
import { readFileSync } from 'node:fs'
import { decodePacket, verifyAdvertSignature } from '../../../../app/src/decode.js'
import { classifyReception, carriesSignedIdentity, stripIdentity, undecodableReception } from '../../../../app/src/meshpacket.js'

const raws = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out = []
for (const raw of raws) {
  const decoded = decodePacket(raw)
  let cls = decoded && decoded.isValid ? classifyReception(decoded, () => null) : undecodableReception()
  if (carriesSignedIdentity(cls) && !(await verifyAdvertSignature(raw))) cls = stripIdentity(cls)
  out.push({
    raw,
    packet_type: cls.packetType,
    hops: cls.hops,
    is_direct: cls.isDirect,
    sender_kind: cls.sender.kind || '',
    sender_id: cls.sender.id || '',
    sender_label: cls.sender.label || '',
    sender_role: cls.sender.role || '',
  })
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n')
