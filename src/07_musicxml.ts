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
} from './types.js'
import * as quantize from './06_quantize.js'
import * as st from './01_state.js'
import * as util from './00_util.js'

export const PITCH_STEPS = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
]

export function pitch_xml(midi: number) {
  let pc = PITCH_STEPS[midi % 12]
  let octave = Math.floor(midi / 12) - 1
  let alter = pc.alter ? '<alter>1</alter>' : ''
  return (
    '<pitch><step>' +
    pc.step +
    '</step>' +
    alter +
    '<octave>' +
    octave +
    '</octave></pitch>'
  )
}

export interface ChordSeg {
  tick: number
  dur: number
  tie_start?: boolean
  tie_stop?: boolean
  pitches?: QuantPitch[]
}
export type MeasureCell = Record<number, ChordSeg[]>

export function segment_chord(
  chord: QuantChord,
  measure_div: number,
): ChordSeg[] {
  const segs: ChordSeg[] = []
  let pos = chord.tick
  let remaining = chord.dur
  while (remaining > 0) {
    let measure_end = (Math.floor(pos / measure_div) + 1) * measure_div
    let span = Math.min(remaining, measure_end - pos)
    segs.push({
      tick: pos,
      dur: span,
      tie_stop: segs.length > 0,
      tie_start: false,
    })
    pos += span
    remaining -= span
  }
  for (let i = 0; i < segs.length - 1; i++) segs[i].tie_start = true
  return segs
}

export function chord_segment_xml(
  seg: ChordSeg,
  pitches: QuantPitch[],
  voice: number,
  staff: number,
): string {
  const pieces = quantize.decompose(seg.dur)
  if (!pieces || !pieces.length) return ''
  let xml = ''
  for (let pi = 0; pi < pieces.length; pi++) {
    let piece = pieces[pi]
    let tie_start = seg.tie_start || pi < pieces.length - 1
    let tie_stop = seg.tie_stop || pi > 0
    for (let ni = 0; ni < pitches.length; ni++) {
      let p = pitches[ni]
      xml += '<note>'
      if (ni > 0) xml += '<chord/>'
      xml += pitch_xml(p.pitch)
      xml += '<duration>' + piece.div + '</duration>'
      if (tie_stop) xml += '<tie type="stop"/>'
      if (tie_start) xml += '<tie type="start"/>'
      xml += '<voice>' + voice + '</voice>'
      xml += '<type>' + piece.type + '</type>'
      for (let d = 0; d < piece.dots; d++) xml += '<dot/>'
      if (piece.tuplet) {
        xml +=
          '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
      }
      xml += '<staff>' + staff + '</staff>'
      if (tie_stop || tie_start) {
        xml += '<notations>'
        if (tie_stop) xml += '<tied type="stop"/>'
        if (tie_start) xml += '<tied type="start"/>'
        xml += '</notations>'
      }
      xml += '</note>'
    }
  }
  return xml
}

export function rest_xml(dur: number, voice: number, staff: number): string {
  const pieces = quantize.decompose(dur) || []
  let xml = ''
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i]
    xml +=
      '<note><rest/><duration>' +
      piece.div +
      '</duration><voice>' +
      voice +
      '</voice>'
    xml += '<type>' + piece.type + '</type>'
    for (let d = 0; d < piece.dots; d++) xml += '<dot/>'
    if (piece.tuplet) {
      xml +=
        '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
    }
    xml += '<staff>' + staff + '</staff></note>'
  }
  return xml
}

export function staff_measure_xml(
  segments: ChordSeg[],
  measure_start: number,
  measure_div: number,
  voice: number,
  staff: number,
): string {
  if (!segments.length) {
    return (
      '<note><rest measure="yes"/><duration>' +
      measure_div +
      '</duration><voice>' +
      voice +
      '</voice><staff>' +
      staff +
      '</staff></note>'
    )
  }
  let xml = ''
  let pos = measure_start
  for (let i = 0; i < segments.length; i++) {
    let s = segments[i]
    if (s.tick > pos) {
      xml += rest_xml(s.tick - pos, voice, staff)
      pos = s.tick
    }
    xml += chord_segment_xml(s, s.pitches || [], voice, staff)
    pos = s.tick + s.dur
  }
  let measure_end = measure_start + measure_div
  if (pos < measure_end) {
    xml += rest_xml(measure_end - pos, voice, staff)
  }
  return xml
}

export function layout_measures(quantized: Quantized) {
  let md = quantized.measure_div
  let count = quantized.measure_count
  const layout: MeasureCell[] = []
  for (let i = 0; i < count; i++) layout.push({ 1: [], 2: [] })
  for (const staff of [1, 2]) {
    let chords = quantized.staves[staff]
    for (let c = 0; c < chords.length; c++) {
      let segs = segment_chord(chords[c], md)
      for (let s = 0; s < segs.length; s++) {
        let mi = Math.floor(segs[s].tick / md)
        if (mi >= count) continue
        layout[mi][staff].push({
          tick: segs[s].tick,
          dur: segs[s].dur,
          tie_start: segs[s].tie_start,
          tie_stop: segs[s].tie_stop,
          pitches: chords[c].pitches,
        })
      }
    }
    for (let m = 0; m < count; m++) {
      layout[m][staff].sort(function (a, b) {
        return a.tick - b.tick
      })
    }
  }
  return layout
}

export interface BuildOpts {
  from?: number
  to?: number
  layout?: MeasureCell[]
}
export function build(quantized: Quantized, opts?: BuildOpts): string {
  let from = opts && opts.from != null ? opts.from : 0
  let to = opts && opts.to != null ? opts.to : quantized.measure_count
  from = util.clamp(from, 0, quantized.measure_count)
  to = util.clamp(to, from, quantized.measure_count)

  let layout = opts && opts.layout ? opts.layout : layout_measures(quantized)
  let md = quantized.measure_div

  let measures_xml = ''
  for (let m = from; m < to; m++) {
    let num = m - from + 1
    let attrs = ''
    if (m === from) {
      attrs =
        '<attributes><divisions>' +
        st.DIV +
        '</divisions>' +
        '<key><fifths>0</fifths></key>' +
        '<time><beats>' +
        quantized.ts_num +
        '</beats><beat-type>' +
        quantized.ts_den +
        '</beat-type></time>' +
        '<staves>2</staves>' +
        '<clef number="1"><sign>G</sign><line>2</line></clef>' +
        '<clef number="2"><sign>F</sign><line>4</line></clef>' +
        '</attributes>' +
        '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' +
        quantized.bpm +
        '</per-minute></metronome></direction-type><sound tempo="' +
        quantized.bpm +
        '"/></direction>'
    }
    let measure_start = m * md
    let right = staff_measure_xml(layout[m][1], measure_start, md, 1, 1)
    let left = staff_measure_xml(layout[m][2], measure_start, md, 2, 2)
    measures_xml +=
      '<measure number="' +
      num +
      '">' +
      attrs +
      right +
      '<backup><duration>' +
      md +
      '</duration></backup>' +
      left +
      '</measure>'
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">' +
    '<score-partwise version="3.1">' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    '<part id="P1">' +
    measures_xml +
    '</part></score-partwise>'
  )
}
