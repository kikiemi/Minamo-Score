const BP_SR = 22050
const AUDIO_N_SAMPLES = 43844
const FFT_HOP = 256
const N_OVERLAP = 30
const HALF_OVERLAP = 15
const OVERLAP_LEN = N_OVERLAP * FFT_HOP
const WIN_HOP = AUDIO_N_SAMPLES - OVERLAP_LEN
const FRAMES_PER_WIN = 172
const ANNOTATIONS_FPS = 86
function make_windows(audio) {
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
function n_output_frames(audio_len) {
  return Math.floor(audio_len * (ANNOTATIONS_FPS / BP_SR))
}
function stitch_to_columns(per_win, C, n_frames) {
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
function merge_tta_columns(frames_a, onsets_a, frames_b, onsets_b, T) {
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
export {
  ANNOTATIONS_FPS,
  AUDIO_N_SAMPLES,
  BP_SR,
  FFT_HOP,
  FRAMES_PER_WIN,
  HALF_OVERLAP,
  N_OVERLAP,
  OVERLAP_LEN,
  WIN_HOP,
  make_windows,
  merge_tta_columns,
  n_output_frames,
  stitch_to_columns,
}
