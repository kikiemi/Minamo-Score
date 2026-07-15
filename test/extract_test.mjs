/* extract_test.mjs - extract.js の単体テスト（合成事後確率） */
import {
  extract_notes,
  events_to_time,
  model_frame_to_time,
  viterbi_segments,
  split_at_onsets,
  median3,
  envelope_corr,
  N_BINS,
} from '../dist/mod/worker/extract.js'

let failures = 0
function assert(cond, msg) {
  if (!cond) {
    failures++
    console.error('  ✗ ' + msg)
  }
}

function make_posteriors(T) {
  const frames = new Array(N_BINS)
  const onsets = new Array(N_BINS)
  for (let b = 0; b < N_BINS; b++) {
    frames[b] = new Float32Array(T)
    onsets[b] = new Float32Array(T)
  }
  return { frames, onsets }
}

/* ノイズ（再現可能） */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const T = 700
const { frames, onsets } = make_posteriors(T)
const rnd = rng(1234)

/* 弱い床ノイズ */
for (let b = 0; b < N_BINS; b++)
  for (let t = 0; t < T; t++) frames[b][t] = rnd() * 0.04

function put_note(bin, s, e, level, onset_level, jitter) {
  for (let t = s; t < e; t++) {
    frames[bin][t] = level + (jitter ? (rnd() - 0.5) * jitter : 0)
  }
  if (onset_level > 0) {
    onsets[bin][s] = onset_level
    if (s + 1 < e) onsets[bin][s + 1] = onset_level * 0.5
  }
}

/* --- 素材 --- */
/* A: 実音 C4 (bin 39), 50..130 */
put_note(39, 50, 130, 0.8, 0.9, 0.1)
/* B: 実オクターブ E5?—いや同時のオクターブ重ね: bin 51, 50..130, 独立オンセットあり */
put_note(51, 50, 130, 0.55, 0.8, 0.16)
/* C: ブリップ（3フレーム・オンセット無し） bin 60, 200..203 */
put_note(60, 200, 203, 0.6, 0, 0)
/* D: 瞬断のある長音 bin 39, 300..400（340,341 で陥没） */
put_note(39, 300, 400, 0.75, 0.85, 0.08)
frames[39][340] = 0.05
frames[39][341] = 0.05
/* E: ゴースト（Dの+12上・包絡=親の0.45倍コピー・オンセットは弱い漏れのみ）
   bin 51, 300..400。実際の倍音漏れはオンセット事後確率にも弱く漏れる */
for (let t = 300; t < 400; t++) frames[51][t] = frames[39][t] * 0.45
onsets[51][300] = 0.35
/* F: 静かな実音（感度パスのみで拾うべき） bin 30, 450..520, f=0.22, onset 0.3 */
put_note(30, 450, 520, 0.22, 0.3, 0.02)
/* H: 減衰する実音（ピアノ的）: bin 25, 100..220。頭0.7→指数減衰で尻尾0.12。
   全体平均≈0.25 だが head mean は高い → 精度パスで採用されるべき */
for (let t = 100; t < 220; t++) {
  frames[25][t] = 0.12 + 0.58 * Math.exp(-(t - 100) / 25)
}
onsets[25][100] = 0.85
onsets[25][101] = 0.4

/* I: サブフレーム補間の検証: bin 70, 300..340, オンセット山が非対称 */
put_note(70, 300, 340, 0.7, 0, 0)
onsets[70][299] = 0.3
onsets[70][300] = 0.9
onsets[70][301] = 0.6

/* G: 同音連打（融合しがち） bin 45, 560..640 連続だが 587, 614 に強オンセット */
put_note(45, 560, 640, 0.7, 0.9, 0.06)
onsets[45][587] = 0.8
onsets[45][614] = 0.75

const passes = {
  precision: { onset: 0.5, frame: 0.3, min_frames: 11 },
  recall: { onset: 0.24, frame: 0.15, min_frames: 5 },
}

const ex = extract_notes(frames, onsets, T, passes)
const P = ex.precision,
  R = ex.recall

function find(list, midi, near_frame) {
  return list.filter(
    (n) => n.pitchMidi === midi && Math.abs(n.startFrame - near_frame) <= 6,
  )
}

console.log('viterbi/抽出:')
assert(find(P, 39 + 21, 50).length === 1, '実音A(精度)')
assert(find(R, 39 + 21, 50).length === 1, '実音A(感度)')
assert(find(P, 51 + 21, 50).length === 1, '実オクターブB は温存（精度）')
assert(find(R, 60 + 21, 200).length === 0, '3フレームブリップC は感度でも棄却')
const d_notes = find(P, 39 + 21, 300)
assert(
  d_notes.length === 1,
  '瞬断ノートD は1音にブリッジ (got ' + d_notes.length + ')',
)
if (d_notes.length === 1) {
  assert(
    d_notes[0].durationFrames >= 95,
    'D の長さが陥没で分断されていない (got ' + d_notes[0].durationFrames + ')',
  )
}
assert(
  find(R, 51 + 21, 300).length === 0,
  'ゴーストE は除去 (removed=' + ex.ghosts_removed + ')',
)
assert(ex.ghosts_removed >= 1, 'ゴースト除去カウント')
assert(find(P, 30 + 21, 450).length === 0, '静音F は精度パスに出ない')
assert(find(R, 30 + 21, 450).length === 1, '静音F は感度パスで回収')

const g_notes = R.filter((n) => n.pitchMidi === 45 + 21).sort(
  (a, b) => a.startFrame - b.startFrame,
)
assert(g_notes.length === 3, '連打G は3音に分割 (got ' + g_notes.length + ')')
if (g_notes.length === 3) {
  assert(
    Math.abs(g_notes[1].startFrame - 587) <= 1 &&
      Math.abs(g_notes[2].startFrame - 614) <= 1,
    '分割位置がオンセット山に一致',
  )
}

{
  const h = find(P, 25 + 21, 100)
  assert(h.length === 1, '減衰音H は精度パスで採用（head mean判定）')
  const ii = find(P, 70 + 21, 300)
  assert(ii.length === 1, '非対称オンセットI 検出')
  if (ii.length === 1) {
    /* frac = 0.5(0.3-0.6)/(0.3-1.8+0.6) = +1/6 → shift ≈ +0.1667 フレーム */
    assert(
      Math.abs((ii[0].onsetShift || 0) - 1 / 6) < 0.02,
      '放物線補間 shift ≈ +0.167 (got ' +
        (ii[0].onsetShift || 0).toFixed(3) +
        ')',
    )
    const timed = events_to_time([ii[0]])
    const expect = model_frame_to_time(300) + ((1 / 6) * 256) / 22050
    assert(
      Math.abs(timed[0].start - expect) < 1e-4,
      'サブフレーム開始時刻 (got ' +
        timed[0].start.toFixed(5) +
        ' expect ' +
        expect.toFixed(5) +
        ')',
    )
  }
}

console.log('タイミング式:')
{
  /* 手計算: frame 200 → 200*256/22050 - 0.0103257...*floor(200/172)
     = 2.322449... - 0.010326 = 2.312124 */
  const t200 = model_frame_to_time(200)
  assert(
    Math.abs(t200 - 2.31212) < 0.0005,
    'modelFrameToTime(200) ≈ 2.3121 (got ' + t200.toFixed(5) + ')',
  )
  const t171 = model_frame_to_time(171)
  const t172 = model_frame_to_time(172)
  assert(
    t172 > t171,
    '窓境界で時刻が単調 (t171=' +
      t171.toFixed(4) +
      ' t172=' +
      t172.toFixed(4) +
      ')',
  )
  const timed = events_to_time([
    { startFrame: 50, durationFrames: 80, pitchMidi: 60, amplitude: 0.8 },
  ])
  assert(
    Math.abs(timed[0].start - model_frame_to_time(50)) < 1e-9,
    'events_to_time start',
  )
  assert(
    timed[0].dur > 0.9 && timed[0].dur < 0.94,
    '80フレーム ≈ 0.93秒 (got ' + timed[0].dur.toFixed(3) + ')',
  )
}

console.log('部品:')
{
  const col = new Float32Array([0, 0, 1, 0, 0])
  const sm = median3(col, 5)
  assert(sm[2] === 0, 'median3 が単発スパイクを除去')
  const a = new Float32Array([1, 2, 3, 4, 5, 6])
  const b = new Float32Array([2, 4, 6, 8, 10, 12])
  assert(
    Math.abs(envelope_corr(a, b, 0, 6) - 1) < 1e-9,
    'envelope_corr 完全相関=1',
  )
  const segs = viterbi_segments(new Float32Array(10), new Float32Array(10), 10)
  assert(segs.length === 0, '無音でセグメント0')
  const one = split_at_onsets({ s: 0, e: 10 }, new Float32Array(10), 0.45, 3)
  assert(one.length === 1, 'オンセット無しは分割しない')
}

console.log(failures ? `\n${failures} 件の失敗` : '\n全テスト成功')
process.exit(failures ? 1 : 0)
