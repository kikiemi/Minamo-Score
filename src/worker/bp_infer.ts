export const BP_SR = 22050
export const AUDIO_N_SAMPLES = 43844
export const FFT_HOP = 256
export const N_OVERLAP = 30
export const HALF_OVERLAP = 15
export const OVERLAP_LEN = N_OVERLAP * FFT_HOP
export const WIN_HOP = AUDIO_N_SAMPLES - OVERLAP_LEN
export const FRAMES_PER_WIN = 172
export const ANNOTATIONS_FPS = 86

export function make_windows(audio: Float32Array): Float32Array[] {
  const lead = OVERLAP_LEN >> 1
  const total = lead + audio.length
  const n_win = Math.ceil(total / WIN_HOP)
  const padded_len = (n_win - 1) * WIN_HOP + AUDIO_N_SAMPLES
  const x = new Float32Array(padded_len)
  x.set(audio, lead)
  const wins = []
  for (let i = 0; i < n_win; i++) {
    wins.push(x.subarray(i * WIN_HOP, i * WIN_HOP + AUDIO_N_SAMPLES))
  }
  return wins
}

export function n_output_frames(audio_len: number): number {
  return Math.floor(audio_len * (ANNOTATIONS_FPS / BP_SR))
}

export function stitch_to_columns(
  per_win: Float32Array[],
  C: number,
  n_frames: number,
): Float32Array[] {
  const cols = new Array(C)
  for (let c = 0; c < C; c++) cols[c] = new Float32Array(n_frames)
  let t_out = 0
  for (let w = 0; w < per_win.length && t_out < n_frames; w++) {
    const mat = per_win[w]
    for (
      let f = HALF_OVERLAP;
      f < FRAMES_PER_WIN - HALF_OVERLAP && t_out < n_frames;
      f++
    ) {
      const base = f * C
      for (let c = 0; c < C; c++) cols[c][t_out] = mat[base + c]
      t_out++
    }
  }
  return cols
}

export function merge_tta_columns(
  frames_a: Float32Array[],
  onsets_a: Float32Array[],
  frames_b: Float32Array[],
  onsets_b: Float32Array[],
  T: number,
): void {
  const C = frames_a.length
  for (let c = 0; c < C; c++) {
    const fa = frames_a[c],
      fb = frames_b[c]
    const oa = onsets_a[c],
      ob = onsets_b[c]
    for (let t = 0; t < T; t++) {
      fa[t] = (fa[t] + fb[t]) * 0.5
      if (ob[t] > oa[t]) oa[t] = ob[t]
    }
  }
}
