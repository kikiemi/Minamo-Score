import type {
  Note,
  Preset,
  Passes,
  EnginePlan,
  Quantized,
  QuantOpts,
  AssembleMeta,
  QuantChord,
  QuantPitch,
  QuantNote,
  HistoryRecord,
  DecodeResult,
  MidiEvent,
} from './types.js'
import * as st from './01_state.js'
import * as util from './00_util.js'

export const PPQ = 480

export function _varlen(v: number) {
  let bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes
}

export function _str_bytes(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

export function _build_smf(events: MidiEvent[], bpm: number) {
  events.sort(function (a: MidiEvent, b: MidiEvent) {
    return a.tick - b.tick
  })

  let track: number[] = []

  let uspq = Math.round(60000000 / bpm)
  track = track.concat([
    0x00,
    0xff,
    0x51,
    0x03,
    (uspq >> 16) & 0xff,
    (uspq >> 8) & 0xff,
    uspq & 0xff,
  ])

  track = track.concat([0x00, 0xc0, 0x00])

  let last_tick = 0
  for (let i = 0; i < events.length; i++) {
    let e = events[i]
    let delta = Math.max(0, e.tick - last_tick)
    track = track.concat(_varlen(delta), e.bytes)
    last_tick = e.tick
  }

  track = track.concat([0x00, 0xff, 0x2f, 0x00])

  let header = _str_bytes('MThd').concat([
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ])
  let track_len = track.length
  let chunk = _str_bytes('MTrk').concat([
    (track_len >>> 24) & 0xff,
    (track_len >>> 16) & 0xff,
    (track_len >>> 8) & 0xff,
    track_len & 0xff,
  ])

  return new Blob([new Uint8Array(header.concat(chunk, track))], {
    type: 'audio/midi',
  })
}

export function build_quantized(quantized: Quantized) {
  let scale = PPQ / st.DIV
  let events: MidiEvent[] = []
  for (const staff of [1, 2]) {
    let chords = quantized.staves[staff]
    for (let c = 0; c < chords.length; c++) {
      let ch = chords[c]
      for (let p = 0; p < ch.pitches.length; p++) {
        let note = ch.pitches[p]
        events.push({
          tick: Math.round(ch.tick * scale),
          bytes: [0x90, note.pitch, util.clamp(note.velocity, 1, 127)],
        })
        events.push({
          tick: Math.round((ch.tick + ch.dur) * scale),
          bytes: [0x80, note.pitch, 0],
        })
      }
    }
  }
  return _build_smf(events, quantized.bpm)
}

export function build_raw(raw_notes: Note[], bpm: number) {
  let quarter = 60 / bpm
  let events: MidiEvent[] = []
  for (let i = 0; i < raw_notes.length; i++) {
    let n = raw_notes[i]
    let on = Math.round((n.start / quarter) * PPQ)
    let off = Math.round(((n.start + n.dur) / quarter) * PPQ)
    if (off <= on) off = on + 1
    events.push({
      tick: on,
      bytes: [0x90, n.pitch, util.clamp(n.velocity || 80, 1, 127)],
    })
    events.push({ tick: off, bytes: [0x80, n.pitch, 0] })
  }
  return _build_smf(events, bpm)
}
