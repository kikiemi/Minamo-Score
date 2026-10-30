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
import * as audio from './02_audio.js'
import * as notes from './04_notes.js'
import * as st from './01_state.js'
import * as util from './00_util.js'

export let master: GainNode | null = null

export let start_ctx_time = 0

export let start_pos = 0

export let scheduler = 0

export let scheduled_index = 0

export let sorted_notes: Note[] = []

export let on_tick: ((pos: number) => void) | null = null

let on_end: (() => void) | null = null
export function set_on_end(fn: (() => void) | null): void {
  on_end = fn
}

export let SAMPLE_BASE =
  'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/acoustic_grand_piano-mp3/'

export const samples = new Map<number, AudioBuffer>()

export let sample_loading = new Map()

export let sample_failed = new Set()

export let force_synth = false

export function sample_name(pitch: number) {
  let NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
  let octave = Math.floor(pitch / 12) - 1
  return NAMES[pitch % 12] + octave
}

export function _load_sample(pitch: number) {
  if (samples.has(pitch)) return Promise.resolve(true)
  if (sample_failed.has(pitch)) return Promise.resolve(false)
  if (sample_loading.has(pitch)) return sample_loading.get(pitch)

  let url = SAMPLE_BASE + sample_name(pitch) + '.mp3'
  let p = fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.arrayBuffer()
    })
    .then(function (buf) {
      return audio.ctx().decodeAudioData(buf)
    })
    .then(function (audio_buf) {
      samples.set(pitch, audio_buf)
      sample_loading.delete(pitch)
      return true
    })
    .catch(function () {
      sample_failed.add(pitch)
      sample_loading.delete(pitch)
      return false
    })
  sample_loading.set(pitch, p)
  return p
}

export function preload(
  notes: Note[],
  on_progress?: ((done: number, total: number) => void) | null,
) {
  let pitches = []
  let seen = new Set()
  for (let i = 0; i < notes.length; i++) {
    let p = notes[i].pitch
    if (
      p >= 21 &&
      p <= 108 &&
      !seen.has(p) &&
      !samples.has(p) &&
      !sample_failed.has(p)
    ) {
      seen.add(p)
      pitches.push(p)
    }
  }
  if (!pitches.length) return Promise.resolve(0)

  let done = 0,
    ok = 0,
    idx = 0
  return new Promise(function (resolve) {
    let next = function () {
      if (idx >= pitches.length) return
      let p = pitches[idx++]
      _load_sample(p).then(function (success: boolean) {
        if (success) ok++
        done++
        if (on_progress) on_progress(done, pitches.length)
        if (done === pitches.length) {
          if (!ok && !samples.size) force_synth = true
          resolve(ok)
        } else {
          next()
        }
      })
    }
    let lanes = Math.min(6, pitches.length)
    for (let l = 0; l < lanes; l++) next()
  })
}

export function _nearest_sample(pitch: number) {
  if (samples.has(pitch)) return { pitch: pitch, buf: samples.get(pitch) }
  for (let d = 1; d <= 5; d++) {
    if (samples.has(pitch - d))
      return { pitch: pitch - d, buf: samples.get(pitch - d) }
    if (samples.has(pitch + d))
      return { pitch: pitch + d, buf: samples.get(pitch + d) }
  }
  return null
}

export function _ensure_master() {
  let ctx = audio.ctx()
  if (ctx!.state === 'suspended') ctx!.resume()
  if (!master) {
    let comp = ctx!.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 6
    let gain = ctx!.createGain()
    gain.gain.value = 0.8
    gain.connect(comp)
    comp.connect(ctx!.destination)
    master = gain
  }
  return audio.ctx()
}

export function _schedule_sample(
  ctx: AudioContext,
  note: Note,
  when: number,
  hit: { pitch: number; buf: AudioBuffer | undefined },
): void {
  let vel = (note.velocity || 80) / 127
  let dur = Math.max(0.06, note.dur)

  let src = ctx!.createBufferSource()
  src.buffer = hit.buf || null
  if (hit.pitch !== note.pitch) {
    src.playbackRate.value = Math.pow(2, (note.pitch - hit.pitch) / 12)
  }

  let filt = ctx!.createBiquadFilter()
  filt.type = 'lowpass'
  filt.frequency.value = 1400 + vel * 9000
  filt.Q.value = 0.4

  let env = ctx!.createGain()
  let g = 0.22 + 0.78 * Math.pow(vel, 1.4)
  env.gain.setValueAtTime(g, when)

  let t_end = when + dur
  env.gain.setTargetAtTime(0.0001, t_end, 0.1)

  src.connect(filt)
  filt.connect(env)
  env.connect(master!)
  src.start(when)
  src.stop(t_end + 0.6)
}

export function _schedule_synth(ctx: AudioContext, note: Note, when: number) {
  let freq = 440 * Math.pow(2, (note.pitch - 69) / 12)
  let vel = (note.velocity || 80) / 127
  let dur = Math.max(0.06, note.dur)

  let osc1 = ctx!.createOscillator()
  osc1.type = 'triangle'
  osc1.frequency.value = freq
  let osc2 = ctx!.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.value = freq * 2

  let filt = ctx!.createBiquadFilter()
  filt.type = 'lowpass'
  filt.frequency.value = 700 + vel * 3400
  filt.Q.value = 0.5

  let g1 = ctx!.createGain()
  let g2 = ctx!.createGain()
  g2.gain.value = 0.22
  let env = ctx!.createGain()

  osc1.connect(g1)
  osc2.connect(g2)
  g1.connect(filt)
  g2.connect(filt)
  filt.connect(env)
  env.connect(master!)

  let peak = 0.06 + vel * 0.32
  let attack = 0.004
  let release = 0.09
  let sustain_end = when + dur

  env.gain.setValueAtTime(0.0001, when)
  env.gain.linearRampToValueAtTime(peak, when + attack)
  env.gain.setTargetAtTime(
    peak * 0.25,
    when + attack,
    Math.max(0.12, dur * 0.5),
  )
  env.gain.setTargetAtTime(0.0001, sustain_end, release / 3)

  osc1.start(when)
  osc2.start(when)
  let stop_at = sustain_end + release + 0.05
  osc1.stop(stop_at)
  osc2.stop(stop_at)
}

export function _schedule_note(ctx: AudioContext, note: Note, when: number) {
  if (!force_synth) {
    let hit = _nearest_sample(note.pitch)
    if (hit) {
      _schedule_sample(ctx, note, when, hit)
      return
    }
  }
  _schedule_synth(ctx, note, when)
}

export function position() {
  if (!st.S.playing) return start_pos
  let ctx = audio.ctx()
  return start_pos + (ctx!.currentTime - start_ctx_time)
}

export function play(from_sec?: number | null) {
  let S = st.S
  if (!S.raw_notes.length) return
  stop(true)

  let ctx = _ensure_master()
  let pos = util.clamp(from_sec != null ? from_sec : S.play_pos, 0, S.duration)
  if (pos >= S.duration - 0.05) pos = 0

  sorted_notes = S.raw_notes.slice().sort(function (a, b) {
    return a.start - b.start
  })
  scheduled_index = 0

  while (
    scheduled_index < sorted_notes.length &&
    sorted_notes[scheduled_index].start < pos - 0.02
  ) {
    scheduled_index++
  }

  start_pos = pos
  start_ctx_time = ctx!.currentTime + 0.06
  S.playing = true
  S.play_pos = pos

  let lookahead = 0.6
  let tick = function () {
    if (!S.playing) return
    let now_pos = position()
    let horizon = now_pos + lookahead
    let list = sorted_notes
    while (
      scheduled_index < list.length &&
      list[scheduled_index].start <= horizon
    ) {
      let n = list[scheduled_index]
      let when = start_ctx_time + (n.start - start_pos)
      if (when >= ctx!.currentTime - 0.01) {
        _schedule_note(ctx, n, Math.max(ctx!.currentTime + 0.005, when))
      }
      scheduled_index++
    }
    if (now_pos >= S.duration + 0.4) {
      stop()
      if (on_end) on_end()
      return
    }
    scheduler = setTimeout(tick, 120)
  }
  tick()
}

export function pause() {
  let S = st.S
  if (!S.playing) return
  S.play_pos = position()
  stop(true)
  S.play_pos = util.clamp(S.play_pos, 0, S.duration)
}

export function stop(keep_pos?: boolean) {
  let S = st.S
  clearTimeout(scheduler)
  if (master) {
    let ctx = audio.ctx()
    let g = master.gain
    g.cancelScheduledValues(ctx!.currentTime)
    g.setValueAtTime(g.value, ctx!.currentTime)
    g.linearRampToValueAtTime(0.0001, ctx!.currentTime + 0.06)
    let old_master = master
    setTimeout(function () {
      try {
        old_master.disconnect()
      } catch (e) {}
    }, 120)
    master = null
  }
  S.playing = false
  if (!keep_pos) S.play_pos = 0
}

export function seek(sec: number) {
  let S = st.S
  let was_playing = S.playing
  S.play_pos = util.clamp(sec, 0, S.duration)
  if (was_playing) {
    play(S.play_pos)
  }
}
