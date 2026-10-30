import type { Note, Passes, PassThresholds } from '../types'
import type { OrtLike, OrtSession } from './ort_types'

export type Progress = ((ratio: number, text: string) => void) | null

import * as HR from './hires.js'
import * as BP from './bp_infer.js'
import * as CFP from './cfp.js'
import { extract_notes, events_to_time, N_BINS } from './extract.js'

export function normalize_peak(samples: Float32Array): void {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i]
    if (a > peak) peak = a
  }
  if (peak < 1e-5) return
  if (peak > 0.5 && peak < 0.99) return
  let g = 0.95 / peak
  if (g > 20) g = 20
  for (let i = 0; i < samples.length; i++) samples[i] *= g
}

export async function run_hires(
  ort: OrtLike,
  session: OrtSession,
  samples: Float32Array,
  on_progress: Progress,
): Promise<Passes> {
  const plan = HR.plan_segments(samples.length)
  const padded = new Float32Array(plan.padded_len)
  padded.set(samples, 0)

  const keys = [
    'reg_onset_output',
    'reg_offset_output',
    'frame_output',
    'velocity_output',
  ]
  const accs: Record<string, HR.BlendAcc> = {}
  for (const k of keys) accs[k] = HR.blend_init(plan, HR.CLASSES)

  for (let i = 0; i < plan.n_seg; i++) {
    const seg = HR.segment_view(padded, i)
    if (HR.is_silent(seg)) {
      for (const k of keys) HR.blend_add(accs[k], i, null)
    } else {
      const input = new ort.Tensor('float32', seg, [1, HR.SEG_SAMPLES])
      const res = await session.run({ waveform: input })
      for (const k of keys) {
        HR.blend_add(accs[k], i, new Float32Array(res[k].data))
      }
    }
    if (on_progress) {
      on_progress((0.9 * (i + 1)) / plan.n_seg, '高精度AIで解析中…')
    }
  }

  const reg_on = HR.blend_finish(accs.reg_onset_output, samples.length)
  const reg_off = HR.blend_finish(accs.reg_offset_output, samples.length)
  const frame = HR.blend_finish(accs.frame_output, samples.length)
  const vel = HR.blend_finish(accs.velocity_output, samples.length)
  const T = reg_on.T

  if (on_progress) on_progress(0.9, '音の物証（CFP）を計算中…')

  const sal = CFP.cfp_salience(samples)
  const scale = CFP.cfp_scale(sal)

  if (on_progress) on_progress(0.95, '音符を抽出中（回帰後処理）…')

  const precision = HR.detect_notes(
    reg_on.data,
    reg_off.data,
    frame.data,
    vel.data,
    T,
  )

  const tiers = [
    {
      opt: {
        onset_threshold: 0.15,
        offset_threshold: 0.3,
        frame_threshold: 0.06,
        onset_neighbour: 1,
      },
      ev: 0.12,
    },
    {
      opt: {
        onset_threshold: 0.08,
        offset_threshold: 0.3,
        frame_threshold: 0.04,
        onset_neighbour: 1,
      },
      ev: 0.2,
    },
  ]
  const recall = precision.slice()
  const seen = (n: Note): boolean =>
    recall.some(
      (q) => q.pitch === n.pitch && Math.abs(q.start - n.start) < 0.03,
    )
  let rejected = 0
  for (const tier of tiers) {
    const cand = HR.detect_notes(
      reg_on.data,
      reg_off.data,
      frame.data,
      vel.data,
      T,
      tier.opt,
    )
    for (const n of cand) {
      if (seen(n)) continue
      if (CFP.cfp_evidence(sal, scale, n.start, n.dur, n.pitch) >= tier.ev)
        recall.push(n)
      else rejected++
    }
  }

  const rescued = HR.frame_only_rescue(frame.data, vel.data, T, recall, {
    th_frame: 0.4,
    min_frames: 12,
  })
  for (const n of rescued) {
    if (CFP.cfp_evidence(sal, scale, n.start, n.dur, n.pitch) >= 0.3)
      recall.push(n)
    else rejected++
  }

  return { precision, recall, ghosts_removed: rejected }
}

async function run_bp_once(
  ort: OrtLike,
  session: OrtSession,
  samples: Float32Array,
  on_progress: Progress,
  p0: number,
  p1: number,
) {
  const wins = BP.make_windows(samples)
  const per_frames: Float32Array[] = [],
    per_onsets: Float32Array[] = []
  const BATCH = 4
  const stride = BP.FRAMES_PER_WIN * N_BINS
  for (let i = 0; i < wins.length; i += BATCH) {
    const n = Math.min(BATCH, wins.length - i)
    const buf = new Float32Array(n * BP.AUDIO_N_SAMPLES)
    for (let b = 0; b < n; b++) buf.set(wins[i + b], b * BP.AUDIO_N_SAMPLES)
    const input = new ort.Tensor('float32', buf, [n, BP.AUDIO_N_SAMPLES, 1])
    const res = await session.run({ 'serving_default_input_2:0': input })

    const fr = res['StatefulPartitionedCall:1'].data
    const on = res['StatefulPartitionedCall:2'].data
    for (let b = 0; b < n; b++) {
      per_frames.push(
        new Float32Array(fr.buffer, fr.byteOffset + b * stride * 4, stride),
      )
      per_onsets.push(
        new Float32Array(on.buffer, on.byteOffset + b * stride * 4, stride),
      )
    }
    if (on_progress) {
      on_progress(p0 + (p1 - p0) * ((i + n) / wins.length), '音を解析中…')
    }
  }
  const T = BP.n_output_frames(samples.length)
  return {
    frames_t: BP.stitch_to_columns(per_frames, N_BINS, T),
    onsets_t: BP.stitch_to_columns(per_onsets, N_BINS, T),
    T,
  }
}

export async function run_bp(
  ort: OrtLike,
  session: OrtSession,
  samples: Float32Array,
  quality: string,
  precision_pass: PassThresholds,
  recall_pass: PassThresholds,
  on_progress: Progress,
): Promise<Passes> {
  const high = quality === 'high'

  const r1 = await run_bp_once(
    ort,
    session,
    samples,
    on_progress,
    0.02,
    high ? 0.45 : 0.9,
  )
  if (!r1.T) throw new Error('解析結果が空でした')
  let frames_t = r1.frames_t,
    onsets_t = r1.onsets_t,
    T = r1.T

  if (high) {
    if (on_progress) on_progress(0.46, '精度向上のため再解析中…')
    const shifted = new Float32Array(samples.length + 128)
    shifted.set(samples, 128)
    const r2 = await run_bp_once(ort, session, shifted, on_progress, 0.47, 0.9)
    const T2 = Math.min(T, r2.T)
    BP.merge_tta_columns(frames_t, onsets_t, r2.frames_t, r2.onsets_t, T2)
    T = T2
  }

  if (on_progress) on_progress(0.92, '音符を抽出中（Viterbi復号）…')
  const ex = extract_notes(frames_t, onsets_t, T, {
    precision: precision_pass,
    recall: recall_pass,
  })
  return {
    precision: events_to_time(ex.precision),
    recall: events_to_time(ex.recall),
    ghosts_removed: ex.ghosts_removed,
  }
}
