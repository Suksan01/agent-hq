// Writes the space theme's five sounds (web/space-sounds.js, the same samples the design page plays) as WAV clips named
// like assets/*.wav, into a scratch folder for listening first; after approval they are copied over assets/.
// Run: node scripts/make-space-sounds.mjs [out folder]   (default: <tmp>/agent-hq-space-sounds)
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { PEAK, SOUND_NAMES, renderSound } from '../web/space-sounds.js'

const RATE = 22050 // everything is low-passed at 2.5 kHz, so 22 kHz loses nothing and halves the files
const OUT = resolve(process.argv[2] ?? join(tmpdir(), 'agent-hq-space-sounds'))
const FILE = { start: 'start.wav', done: 'done.wav', needs_you: 'needs-you.wav', failed: 'failed.wav', levelup: 'levelup.wav' } // hooks/sounds.ts SOUND_ASSET

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** A clip fit to ship: real samples, at the agreed level, short, and ending in silence (no click). */
function check(name, x) {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const problems = [
    x.some(Number.isNaN) && 'NaN samples',
    Math.abs(peak - PEAK) > 0.01 && `peak ${peak.toFixed(3)}, want ${PEAK}`,
    x.length / RATE > 3 && `${(x.length / RATE).toFixed(2)} s is too long`,
    Math.abs(x[x.length - 1]) > 0.001 && 'does not end in silence',
  ].filter(Boolean)
  if (problems.length > 0) throw new Error(`${name}: ${problems.join(', ')}`)
}

mkdirSync(OUT, { recursive: true })
for (const name of SOUND_NAMES) {
  const samples = renderSound(name, RATE)
  check(name, samples)
  writeFileSync(join(OUT, FILE[name]), wav(samples))
  console.log(`${FILE[name].padEnd(14)} ${(samples.length / RATE).toFixed(2)} s`)
}
console.log(`wrote ${SOUND_NAMES.length} clips to ${OUT}`)
