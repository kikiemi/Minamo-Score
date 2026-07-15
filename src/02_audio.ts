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
  ChordGroup,
  MeasureBox,
} from './types.js'
let on_record_done: ((blob: Blob) => void) | null = null
export function set_on_record_done(fn: ((blob: Blob) => void) | null): void {
  on_record_done = fn
}

import * as st from './01_state.js'

export let TARGET_RATE = 22050

export let _ctx: AudioContext | null = null

export function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)()
  }
  return _ctx
}

export async function decode(
  file: File | Blob,
  vocal_cut: boolean,
  rate: number,
) {
  let buf = await file.arrayBuffer()
  let decoded = await ctx().decodeAudioData(buf)
  let duration = decoded.duration

  let mono
  if (vocal_cut && decoded.numberOfChannels >= 2) {
    let l = decoded.getChannelData(0)
    let r = decoded.getChannelData(1)
    mono = new Float32Array(l.length)
    for (let i = 0; i < l.length; i++) mono[i] = (l[i] - r[i]) * 0.5
  } else if (decoded.numberOfChannels >= 2) {
    let l2 = decoded.getChannelData(0)
    let r2 = decoded.getChannelData(1)
    mono = new Float32Array(l2.length)
    for (let j = 0; j < l2.length; j++) mono[j] = (l2[j] + r2[j]) * 0.5
  } else {
    mono = decoded.getChannelData(0)
  }

  let target = rate || TARGET_RATE
  let samples
  if (decoded.sampleRate === target) {
    samples = new Float32Array(mono)
  } else {
    let frames = Math.max(1, Math.ceil(duration * target))
    let offline = new OfflineAudioContext(1, frames, target)
    let mono_buf = offline.createBuffer(1, mono.length, decoded.sampleRate)
    mono_buf.copyToChannel(mono, 0)
    let src = offline.createBufferSource()
    src.buffer = mono_buf
    src.connect(offline.destination)
    src.start(0)
    let rendered = await offline.startRendering()
    samples = new Float32Array(rendered.getChannelData(0))
  }

  preprocess(samples)
  return { samples: samples, duration: duration }
}

export function preprocess(samples: Float32Array) {
  let n = samples.length
  let x1 = 0,
    y1 = 0,
    i
  for (i = 0; i < n; i++) {
    let x0 = samples[i]
    let y0 = x0 - x1 + 0.995 * y1
    samples[i] = y0
    x1 = x0
    y1 = y0
  }
  let peak = 0
  for (i = 0; i < n; i++) {
    let a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak > 1e-6) {
    let gain = 0.95 / peak
    for (i = 0; i < n; i++) samples[i] *= gain
  }
}

export async function start_record() {
  let S = st.S
  let stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
  let mime = ''
  let candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (let i = 0; i < candidates.length; i++) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) {
      mime = candidates[i]
      break
    }
  }
  S.record_chunks = []
  S.media_recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  )
  S.media_recorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) S.record_chunks.push(e.data)
  }
  const rec = S.media_recorder
  if (!rec) return
  rec.onstop = function () {
    stream.getTracks().forEach(function (t) {
      t.stop()
    })
    S.record_blob = new Blob(S.record_chunks, {
      type: rec.mimeType || 'audio/webm',
    })
    if (on_record_done) on_record_done(S.record_blob)
  }
  S.media_recorder.start()
}

export function stop_record() {
  let S = st.S
  if (S.media_recorder && S.media_recorder.state !== 'inactive') {
    if (S.media_recorder) S.media_recorder.stop()
  }
}

on_record_done = null
