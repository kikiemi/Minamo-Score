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
import * as notes from './04_notes.js'
import * as player from './10_player.js'
import * as st from './01_state.js'
import * as util from './00_util.js'

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let pitch_min = 36
let pitch_max = 84

export let on_seek: (() => void) | null = null

export function init(): void {
  canvas = util.el('roll_canvas') as HTMLCanvasElement
  ctx = canvas.getContext('2d')

  const seek_from_event = function (e: PointerEvent): void {
    const S = st.S
    if (!S.duration || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const t = util.clamp(x / rect.width, 0, 1) * S.duration
    player.seek(t)
    draw()
    if (on_seek) on_seek()
  }
  canvas.addEventListener('pointerdown', seek_from_event)
  window.addEventListener('resize', function () {
    resize()
  })
  resize()
}

export function resize() {
  let c = canvas
  if (!c) return
  let dpr = Math.max(1, window.devicePixelRatio || 1)
  let rect = c.getBoundingClientRect()
  let w = Math.max(200, Math.round(rect.width * dpr))
  let h = Math.round(160 * dpr)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  draw()
}

export function set_range(notes: Note[]) {
  if (!notes.length) {
    pitch_min = 36
    pitch_max = 84
    return
  }
  let lo = 127,
    hi = 0
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].pitch < lo) lo = notes[i].pitch
    if (notes[i].pitch > hi) hi = notes[i].pitch
  }
  pitch_min = Math.max(21, lo - 2)
  pitch_max = Math.min(108, hi + 2)
}

export function draw(): void {
  const S = st.S
  const c = canvas
  const cx = ctx
  if (!c || !cx) return
  const w = c.width,
    h = c.height
  cx.clearRect(0, 0, w, h)

  if (!S.raw_notes.length || !S.duration) return

  let range = Math.max(1, pitch_max - pitch_min)
  let row_h = h / range

  cx.fillStyle = 'rgba(240, 220, 196, .5)'
  for (let p = pitch_min; p <= pitch_max; p++) {
    if (p % 12 === 0) {
      let gy = h - (p - pitch_min) * row_h
      cx.fillRect(0, gy - 1, w, 1)
    }
  }

  for (let i = 0; i < S.raw_notes.length; i++) {
    let n = S.raw_notes[i]
    let x = (n.start / S.duration) * w
    let nw = Math.max(2, (n.dur / S.duration) * w)
    let y = h - (n.pitch - pitch_min + 1) * row_h
    let alpha = 0.45 + util.clamp((n.velocity || 80) / 127, 0, 1) * 0.55
    cx.fillStyle =
      n.staff === 2
        ? 'rgba(66, 133, 190, ' + alpha + ')'
        : 'rgba(245, 122, 26, ' + alpha + ')'
    cx.fillRect(x, y, nw, Math.max(2, row_h - 1))
  }

  let pos = S.playing ? player.position() : S.play_pos
  let px = util.clamp(pos / S.duration, 0, 1) * w
  cx.fillStyle = 'rgba(67, 48, 29, .16)'
  cx.fillRect(0, 0, px, h)
  cx.fillStyle = '#d95f00'
  cx.fillRect(px - 1, 0, 3, h)
}
