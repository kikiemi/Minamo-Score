const CFP_FPS = 100
const N_FFT = 4096
const HOP = 160
const SR = 16e3
const GAMMA_SPEC = 0.24
const GAMMA_CEPS = 0.6
const FMIN = 27
const FMAX = 4400
const BEGIN_NOTE = 21
const N_PITCH = 88
function make_fft(n) {
  const levels = Math.log2(n) | 0
  const cos_t = new Float64Array(n / 2)
  const sin_t = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos_t[i] = Math.cos((2 * Math.PI * i) / n)
    sin_t[i] = Math.sin((2 * Math.PI * i) / n)
  }
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1)
    rev[i] = r >>> 0
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half
          const tre = re[l] * cos_t[k] + im[l] * sin_t[k]
          const tim = im[l] * cos_t[k] - re[l] * sin_t[k]
          re[l] = re[j] - tre
          im[l] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}
const fft4096 = make_fft(N_FFT)
const hann = (() => {
  const w = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1))
  return w
})()
function midi_to_hz(m) {
  return 440 * Math.pow(2, (m - 69) / 12)
}
const PITCH_SPEC = []
const PITCH_LAG = []
for (let p = 0; p < N_PITCH; p++) {
  const f = midi_to_hz(BEGIN_NOTE + p)
  const f_lo = f * Math.pow(2, -30 / 1200),
    f_hi = f * Math.pow(2, 30 / 1200)
  let s_lo = Math.floor((f_lo * N_FFT) / SR),
    s_hi = Math.ceil((f_hi * N_FFT) / SR)
  if (s_lo < 1) s_lo = 1
  if (s_hi >= N_FFT / 2) s_hi = N_FFT / 2 - 1
  PITCH_SPEC.push({ lo: s_lo, hi: s_hi })
  let l_lo = Math.floor(SR / f_hi),
    l_hi = Math.ceil(SR / f_lo)
  if (l_lo < 2) l_lo = 2
  if (l_hi >= N_FFT / 2) l_hi = N_FFT / 2 - 1
  PITCH_LAG.push({ lo: l_lo, hi: l_hi })
}
const BIN_FMIN = Math.max(1, Math.round((FMIN * N_FFT) / SR))
const LAG_MIN = Math.max(2, Math.floor(SR / FMAX))
function cfp_salience(samples) {
  const T = Math.floor(samples.length / HOP) + 1
  const S = new Float32Array(T * N_PITCH)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const spec = new Float64Array(N_FFT)
  for (let t = 0; t < T; t++) {
    const center = t * HOP
    const start = center - N_FFT / 2
    let energy = 0
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      const v = idx >= 0 && idx < samples.length ? samples[idx] : 0
      const w = v * hann[i]
      re[i] = w
      im[i] = 0
      energy += w * w
    }
    if (energy < 1e-9) continue
    fft4096(re, im)
    for (let i = 0; i < N_FFT; i++) {
      const m = re[i] * re[i] + im[i] * im[i]
      spec[i] = Math.pow(m, GAMMA_SPEC / 2)
    }
    for (let i = 0; i < BIN_FMIN; i++) {
      spec[i] = 0
      spec[N_FFT - 1 - i] = 0
    }
    for (let i = 0; i < N_FFT; i++) {
      re[i] = spec[i]
      im[i] = 0
    }
    fft4096(re, im)
    for (let i = 0; i < N_FFT / 2; i++) {
      const v = re[i] > 0 ? Math.pow(re[i], GAMMA_CEPS) : 0
      re[i] = i < LAG_MIN ? 0 : v
    }
    const base = t * N_PITCH
    for (let p = 0; p < N_PITCH; p++) {
      const sw = PITCH_SPEC[p]
      let smax = 0
      for (let i = sw.lo; i <= sw.hi; i++) if (spec[i] > smax) smax = spec[i]
      const lw = PITCH_LAG[p]
      let lmax = 0
      for (let i = lw.lo; i <= lw.hi; i++) if (re[i] > lmax) lmax = re[i]
      S[base + p] = smax * lmax
    }
  }
  return { S, T }
}
function cfp_scale(sal) {
  const vals = []
  for (let i = 0; i < sal.S.length; i++) if (sal.S[i] > 0) vals.push(sal.S[i])
  if (!vals.length) return 1
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length * 0.95)] || 1
}
function cfp_evidence(sal, scale, start_sec, dur_sec, pitch) {
  const p = pitch - BEGIN_NOTE
  if (p < 0 || p >= N_PITCH) return 0
  const t0 = Math.max(0, Math.round(start_sec * CFP_FPS))
  const t1 = Math.min(
    sal.T,
    t0 + Math.max(3, Math.min(15, Math.round(dur_sec * CFP_FPS))),
  )
  if (t1 <= t0) return 0
  let sum = 0
  for (let t = t0; t < t1; t++) sum += sal.S[t * N_PITCH + p]
  return sum / (t1 - t0) / (scale || 1)
}
export { BEGIN_NOTE, CFP_FPS, N_PITCH, cfp_evidence, cfp_salience, cfp_scale }
