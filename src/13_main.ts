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
import * as engine from './03_engine.js'
import * as history from './12_history.js'
import * as midi from './08_midi.js'
import * as musicxml from './07_musicxml.js'
import * as notes from './04_notes.js'
import * as player from './10_player.js'
import * as quantize from './06_quantize.js'
import * as roll from './11_roll.js'
import * as score from './09_score.js'
import * as st from './01_state.js'
import * as tempo from './05_tempo.js'
import * as util from './00_util.js'

let $ = util.qs
let on = util.on
let S = st.S

interface ResultCache {
  passes: { precision: Note[]; recall: Note[]; ghosts_removed?: number } | null
  profile: string
  vocal_cut: boolean
  detected_bpm: number
  split: number
  added: number
  backend: string
  engine: string
  quality: string
  base_name: string
}
const cache: ResultCache = {
  passes: null,
  profile: '',
  vocal_cut: false,
  detected_bpm: 120,
  split: 60,
  added: 0,
  backend: '',
  engine: '',
  quality: 'high',
  base_name: 'minamo',
}

function has_result() {
  return !!S.quantized && !!cache.passes
}

let wake_lock: WakeLockSentinel | null = null
async function acquire_wake_lock() {
  try {
    if (navigator.wakeLock && util.is_visible()) {
      wake_lock = await navigator.wakeLock.request('screen')
    }
  } catch (e) {
    wake_lock = null
  }
}
function release_wake_lock() {
  if (wake_lock) {
    try {
      wake_lock.release()
    } catch (e) {}
    wake_lock = null
  }
}

let keepalive_ctx: AudioContext | null = null
let keepalive_osc: OscillatorNode | null = null
function start_keepalive() {
  if (keepalive_ctx) return
  try {
    let AC = window.AudioContext || window.webkitAudioContext
    keepalive_ctx = new AC()
    keepalive_osc = keepalive_ctx.createOscillator()
    let g = keepalive_ctx.createGain()
    keepalive_osc.frequency.value = 30
    g.gain.value = 0.0001
    keepalive_osc.connect(g)
    g.connect(keepalive_ctx.destination)
    keepalive_osc.start()
    keepalive_ctx.resume()
  } catch (e) {
    keepalive_ctx = null
    keepalive_osc = null
  }
}
function stop_keepalive() {
  try {
    if (keepalive_osc) keepalive_osc.stop()
  } catch (e) {}
  try {
    if (keepalive_ctx) keepalive_ctx.close()
  } catch (e) {}
  keepalive_osc = null
  keepalive_ctx = null
}

let busy_lock_release: (() => void) | null = null
function acquire_busy_lock() {
  if (!(navigator.locks && navigator.locks.request) || busy_lock_release) return
  try {
    navigator.locks
      .request('minamoscore-transcribing', function () {
        return new Promise<void>(function (resolve) {
          busy_lock_release = resolve
        })
      })
      .catch(function () {})
  } catch (e) {}
}
function release_busy_lock() {
  if (busy_lock_release) {
    busy_lock_release()
    busy_lock_release = null
  }
}

const base_title = 'Minamo Score'
function set_title_progress(ratio: number | null) {
  util.set_title(
    ratio == null ? null : Math.round(ratio * 100) + '% 解析中',
    base_title,
  )
}

util.on_visibility(function () {
  if (util.is_visible() && S.busy && !wake_lock) acquire_wake_lock()
})

function format_size(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function set_source(blob: Blob, name: string) {
  if (!blob) return
  if (S.source_url) {
    try {
      URL.revokeObjectURL(S.source_url)
    } catch (e) {}
  }
  S.source_file = blob
  S.source_name = name || 'audio'
  S.source_url = URL.createObjectURL(blob)
  cache.base_name = (S.source_name.replace(/\.[^.]+$/, '') || 'minamo').slice(
    0,
    60,
  )

  util.el('source_name').textContent = S.source_name
  util.el('source_meta').textContent =
    (format_size(blob.size) ? format_size(blob.size) + '・' : '') +
    '「変換する」で採譜します'
  let prev = util.el('source_preview')
  prev.src = S.source_url
  prev.classList.remove('is-hidden')
  util.el('source_badge').textContent = '選択済み'
  util.set_status('音声を選択済み')
  if (has_result()) {
    util.set_global_status(
      '音声を差し替えました。「変換する」で採譜し直せます。',
    )
  }
}

on(util.el('file_input'), 'change', function (e) {
  const inp = e.target as HTMLInputElement
  const f = inp.files && inp.files[0]
  if (f) set_source(f, f.name)
  inp.value = ''
})

let dz = util.el('drop_zone')
on(dz, 'dragover', function (e) {
  e.preventDefault()
  dz.classList.add('is-over')
})
on(dz, 'dragleave', function () {
  dz.classList.remove('is-over')
})
on(dz, 'drop', function (e) {
  e.preventDefault()
  dz.classList.remove('is-over')
  const dt = (e as DragEvent).dataTransfer
  const f = dt && dt.files && dt.files[0]
  if (f) set_source(f, f.name)
})

on(util.el('btn_clear_source'), 'click', function () {
  if (S.source_url) {
    try {
      URL.revokeObjectURL(S.source_url)
    } catch (e) {}
  }
  S.source_file = null
  S.source_name = ''
  S.source_url = ''
  util.el('source_name').textContent = '音声が選択されていません'
  util.el('source_meta').textContent = 'ファイルを選ぶか録音してください。'
  let prev = util.el('source_preview')
  prev.removeAttribute('src')
  prev.classList.add('is-hidden')
  util.el('source_badge').textContent = '未選択'
  util.set_status('待機中')
})

on(util.el('btn_record'), 'click', async function () {
  try {
    await audio.start_record()
    util.el('btn_record').disabled = true
    util.el('btn_stop_record').disabled = false
    util.el('btn_use_recording').disabled = true
    let st = util.el('record_status')
    st.textContent = '録音中…'
    st.classList.add('is-live')
  } catch (e) {
    util.toast('マイクを使用できませんでした')
  }
})

on(util.el('btn_stop_record'), 'click', function () {
  audio.stop_record()
  util.el('btn_stop_record').disabled = true
})

audio.set_on_record_done(function (blob) {
  util.el('btn_record').disabled = false
  util.el('btn_stop_record').disabled = true
  util.el('btn_use_recording').disabled = false
  let st = util.el('record_status')
  st.textContent = '録音済み（' + format_size(blob.size) + '）'
  st.classList.remove('is-live')
  let prev = util.el('record_preview')
  prev.src = URL.createObjectURL(blob)
  prev.classList.remove('is-hidden')
})

on(util.el('btn_use_recording'), 'click', function () {
  if (!S.record_blob) return
  let d = new Date()
  function pad(v: number) {
    return (v < 10 ? '0' : '') + v
  }
  let stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes())
  let ext = (S.record_blob.type || '').indexOf('mp4') >= 0 ? '.m4a' : '.webm'
  set_source(S.record_blob, '録音_' + stamp + ext)
})

function build_notes() {
  let preset = st.presets[cache.profile] || st.presets.piano
  if (cache.engine === 'hires') {
    preset = Object.assign({}, preset, {
      merge_ms: 4,
      min_dur: 0.02,
      min_amp: 0.01,
      recall_floor: 0.1,
      dup_ms: 15,
    })
  }
  if (!cache.passes) return
  let built = notes.build(
    cache.passes.precision,
    cache.passes.recall,
    preset,
    util.select('sel_split_mode').value,
    parseInt(util.input('in_split').value, 10),
  )
  S.raw_notes = built.notes
  cache.split = built.split
  cache.added = built.added_by_recall
  if (util.select('sel_split_mode').value === 'auto')
    util.input('in_split').value = String(built.split)
  cache.detected_bpm = tempo.estimate_bpm(S.raw_notes, S.duration)
  if (util.select('sel_bpm_mode').value === 'auto')
    util.input('in_bpm').value = String(cache.detected_bpm)
}

function resolve_bpm() {
  if (util.select('sel_bpm_mode').value === 'manual') {
    return util.clamp(parseInt(util.input('in_bpm').value, 10) || 120, 40, 240)
  }
  return cache.detected_bpm
}

function requantize() {
  if (!cache.passes) return
  let bpm = resolve_bpm()
  let phase = tempo.fit_phase(S.raw_notes, bpm)

  let beats = null
  if (util.select('sel_bpm_mode').value === 'auto') {
    beats = tempo.track_beats(S.raw_notes, S.duration || 0, bpm)
  }
  S.quantized = quantize.run(S.raw_notes, {
    beats: beats,
    bpm: bpm,
    phase: phase,
    grid: util.select('sel_grid').value,
    ts_num: util.clamp(parseInt(util.input('in_ts_num').value, 10) || 4, 1, 12),
    ts_den: parseInt(util.select('sel_ts_den').value, 10) || 4,
    density: util.select('sel_density').value,
    split: cache.split,
  })
  let keep_zoom = S.zoom
  let keep_page = S.page_index
  score.setup(S.quantized, parseInt(util.select('sel_mpp').value, 10) || 4)
  if (keep_zoom) S.zoom = keep_zoom
  S.page_index = util.clamp(keep_page, 0, S.page_count - 1)
  update_summary()
}

function refresh_all() {
  build_notes()
  requantize()
  roll.set_range(S.raw_notes)
  roll.resize()
  score.render_page()
}

function update_summary() {
  let Q = S.quantized
  if (!Q) return
  util.el('sum_duration').textContent = util.fmt_time(S.duration)
  util.el('sum_notes').textContent =
    S.raw_notes.length + (cache.added ? '（+' + cache.added + ' 感度）' : '')
  util.el('sum_bpm').textContent =
    Q.bpm + (util.select('sel_bpm_mode').value === 'auto' ? '・自動' : '')
  if (S.raw_notes.length) {
    let lo = 127,
      hi = 0
    for (let i = 0; i < S.raw_notes.length; i++) {
      if (S.raw_notes[i].pitch < lo) lo = S.raw_notes[i].pitch
      if (S.raw_notes[i].pitch > hi) hi = S.raw_notes[i].pitch
    }
    util.el('sum_range').textContent =
      util.midi_name(lo) + '〜' + util.midi_name(hi)
  } else {
    util.el('sum_range').textContent = '–'
  }
  util.el('sum_grid').textContent = Q.step_label
  util.el('sum_pages').textContent =
    S.page_count + 'ページ / ' + Q.measure_count + '小節'
}

function mark_stale() {
  if (has_result()) {
    util.set_global_status(
      'この設定は「変換する」を押すと反映されます（解析からやり直します）。',
    )
  }
}
on(util.el('sel_profile'), 'change', mark_stale)
on(util.el('sel_quality'), 'change', mark_stale)
on(util.el('chk_vocal_cut'), 'change', mark_stale)

function fast_reflect() {
  if (!has_result()) return
  requantize()
  score.render_page()
}
on(util.el('sel_density'), 'change', fast_reflect)
on(util.el('sel_grid'), 'change', fast_reflect)
on(util.el('in_ts_num'), 'change', fast_reflect)
on(util.el('sel_ts_den'), 'change', fast_reflect)
on(util.el('sel_mpp'), 'change', fast_reflect)

on(util.el('sel_bpm_mode'), 'change', function () {
  util.el('in_bpm').disabled = util.select('sel_bpm_mode').value !== 'manual'
  fast_reflect()
})
on(util.el('in_bpm'), 'change', fast_reflect)

function rebuild_reflect() {
  if (!has_result()) return
  build_notes()
  requantize()
  roll.set_range(S.raw_notes)
  roll.draw()
  score.render_page()
}
on(util.el('sel_split_mode'), 'change', function () {
  util.el('in_split').disabled =
    util.select('sel_split_mode').value !== 'manual'
  rebuild_reflect()
})
on(util.el('in_split'), 'change', rebuild_reflect)

function settings_snapshot() {
  return {
    profile: util.select('sel_profile').value,
    quality: util.select('sel_quality').value,
    vocal_cut: util.input('chk_vocal_cut').checked,
    bpm_mode: util.select('sel_bpm_mode').value,
    bpm_value: parseInt(util.input('in_bpm').value, 10) || 120,
    split_mode: util.select('sel_split_mode').value,
    split_value: parseInt(util.input('in_split').value, 10) || 60,
    grid: util.select('sel_grid').value,
    density: util.select('sel_density').value,
    ts_num: parseInt(util.input('in_ts_num').value, 10) || 4,
    ts_den: parseInt(util.select('sel_ts_den').value, 10) || 4,
    mpp: parseInt(util.select('sel_mpp').value, 10) || 4,
  }
}

function apply_settings(st: Record<string, string | number | boolean> | null) {
  if (!st) return
  util.select('sel_profile').value = String(st.profile || 'piano')
  util.select('sel_quality').value = String(st.quality || 'high')
  util.input('chk_vocal_cut').checked = !!st.vocal_cut
  util.select('sel_bpm_mode').value = String(st.bpm_mode || 'auto')
  util.input('in_bpm').value = String(st.bpm_value || 120)
  util.select('sel_split_mode').value = String(st.split_mode || 'auto')
  util.input('in_split').value = String(st.split_value || 60)
  util.select('sel_grid').value = String(st.grid || 'auto')
  util.select('sel_density').value = String(st.density || 'preserve')
  util.input('in_ts_num').value = String(st.ts_num || 4)
  util.select('sel_ts_den').value = String(st.ts_den || 4)
  util.select('sel_mpp').value = String(st.mpp || 4)
  util.el('in_bpm').disabled = util.select('sel_bpm_mode').value !== 'manual'
  util.el('in_split').disabled =
    util.select('sel_split_mode').value !== 'manual'
}

function save_history() {
  if (!cache.passes || !S.raw_notes.length) return
  let record = {
    id: Date.now(),
    name: S.source_name || cache.base_name,
    created: new Date().toISOString(),
    duration: S.duration,
    backend: cache.backend,
    engine: cache.engine,
    quality: cache.quality,
    notes_count: S.raw_notes.length,
    passes: { precision: cache.passes.precision, recall: cache.passes.recall },
    settings: settings_snapshot(),
  }
  history
    .save(record, S.source_file || null)
    .then(render_history)
    .catch(function () {})
}

function fmt_history_date(iso: string): string {
  let d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  function pad(v: number) {
    return (v < 10 ? '0' : '') + v
  }
  return (
    d.getMonth() +
    1 +
    '/' +
    d.getDate() +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  )
}

function reconvert_history(id: number) {
  if (S.busy) {
    util.toast('処理中です。少し待ってください')
    return
  }
  history
    .get(id)
    .then(function (got) {
      if (!got.record || !got.audio || !got.audio.blob) {
        util.toast('音声が保存されていないため再変換できません')
        return
      }
      let f = new File([got.audio.blob], got.record.name || 'audio', {
        type: got.audio.type || got.audio.blob.type || 'audio/mpeg',
      })
      S.source_file = f
      S.source_name = f.name
      util.el('source_name').textContent = f.name + '（履歴の音声）'
      convert()
    })
    .catch(function () {
      util.toast('履歴の読み込みに失敗しました')
    })
}

function render_history() {
  let ul = util.el('history_list')
  history
    .list()
    .then(function (items) {
      ul.textContent = ''
      if (!items.length) {
        const li0 = util.h('li', 'history-empty')
        li0.textContent = 'まだありません。変換が終わると自動で保存されます。'
        ul.appendChild(li0)
        return
      }
      items.forEach(function (it) {
        const li = util.h('li', 'history-item')

        const info = util.h('div', 'history-info')
        const name = util.h('p', 'history-name')
        name.textContent = it.name || '無題'
        const meta = util.h('p', 'history-meta')
        meta.textContent =
          fmt_history_date(it.created) +
          '・' +
          util.fmt_time(it.duration || 0) +
          '・' +
          (it.notes_count || 0) +
          '音' +
          (it.has_audio ? '' : '・音声なし')
        info.appendChild(name)
        info.appendChild(meta)

        const btns = util.h('div', 'history-btns')
        const open_b = util.hbutton('btn btn-small', '開く')
        util.on(open_b, 'click', function () {
          load_history(it.id)
        })
        const del_b = util.hbutton('btn btn-small btn-danger', '削除')
        util.on(del_b, 'click', function () {
          history
            .remove(it.id)
            .then(render_history)
            .catch(function () {
              util.toast('削除に失敗しました')
            })
        })
        if (it.has_audio) {
          const re_b = util.hbutton('btn btn-small', '再変換')
          re_b.title = '保存された音声を現行エンジンで変換し直す'
          util.on(re_b, 'click', function () {
            reconvert_history(it.id)
          })
          btns.appendChild(re_b)
        }
        btns.appendChild(open_b)
        btns.appendChild(del_b)

        li.appendChild(info)
        li.appendChild(btns)
        ul.appendChild(li)
      })
    })
    .catch(function () {})
}

function load_history(id: number) {
  if (S.busy) {
    util.toast('処理中です。少し待ってください')
    return
  }
  history
    .get(id)
    .then(function (res) {
      let rec = res.record
      if (!rec || !rec.passes) {
        util.toast('この履歴は開けませんでした')
        return
      }
      player.stop()
      stop_frame_loop()

      apply_settings(rec.settings)
      cache.passes = {
        precision: rec.passes.precision || [],
        recall: rec.passes.recall || [],
      }
      cache.profile = rec.settings
        ? String(rec.settings.profile || 'piano')
        : 'piano'
      cache.quality = rec.quality || 'high'
      cache.engine = rec.engine || ''
      cache.backend = rec.backend || ''
      S.duration = rec.duration || 0
      S.play_pos = 0

      if (res.audio && res.audio.blob) {
        set_source(res.audio.blob, rec.name)
      } else {
        cache.base_name = (
          (rec.name || 'minamo').replace(/\.[^.]+$/, '') || 'minamo'
        ).slice(0, 60)
        util.el('source_name').textContent =
          (rec.name || '無題') + '（音声は未保存・再解析は不可）'
      }

      refresh_all()
      util.el('empty_state').classList.add('is-hidden')
      util.el('result_section').classList.remove('is-hidden')
      update_transport()
      player.preload(S.raw_notes)
      util.set_global_status(
        '履歴から復元しました：' + (rec.name || '無題'),
        'ok',
      )
      util.set_status('変換済み')
    })
    .catch(function () {
      util.toast('履歴の読み込みに失敗しました')
    })
}

async function convert() {
  if (S.busy) {
    util.toast('処理中です。少し待ってください')
    return
  }
  if (!S.source_file) {
    util.toast('先に音声を選んでください')
    return
  }
  S.busy = true
  util.el('btn_convert').disabled = true
  acquire_wake_lock()
  acquire_busy_lock()
  start_keepalive()
  player.stop()
  stop_frame_loop()
  util.set_status('変換中…')
  util.set_global_status('音声を読み込んでいます…')
  util.set_progress(0.02, '音声を読み込み中…')

  try {
    let vc = util.input('chk_vocal_cut').checked
    let profile = util.select('sel_profile').value
    let quality = util.select('sel_quality').value
    let plan = engine.plan(profile, quality)
    if (vc && plan.engine === 'hires') {
      vc = false
      util.toast('ピアノ特化AIではボーカルカットを無効にしました')
    }
    let preset = st.presets[profile] || st.presets.piano

    let decoded
    try {
      decoded = await audio.decode(S.source_file, vc, plan.rate)
    } catch (e0) {
      throw new Error('この音声は読み込めませんでした（形式非対応の可能性）')
    }
    S.duration = decoded.duration

    util.set_progress(0.04, '採譜モデルを準備中…')
    let passes = await engine.transcribe(
      decoded.samples,
      preset,
      plan,
      quality,
      function (ratio: number, text: string) {
        let p = 0.04 + util.clamp(ratio, 0, 1) * 0.84
        util.set_progress(p, text)
        set_title_progress(p)
        if (text) util.set_global_status(text)
      },
    )
    cache.passes = passes
    cache.profile = profile
    cache.vocal_cut = vc
    cache.quality = passes.quality || quality
    cache.engine = passes.engine || plan.engine
    cache.backend = passes.backend || ''

    util.set_progress(0.92, '楽譜を組んでいます…')
    util.set_global_status('楽譜を組んでいます…')
    S.play_pos = 0
    refresh_all()

    util.el('empty_state').classList.add('is-hidden')
    util.el('result_section').classList.remove('is-hidden')
    update_transport()

    if (!S.raw_notes.length) {
      util.set_progress(1, '完了（音符なし）')
      util.set_global_status(
        '音を検出できませんでした。音量や「音源の種類」「仕上がり」を見直してください。',
        'error',
      )
    } else {
      util.set_progress(1, '完了')
      const ghosts = (cache.passes && cache.passes.ghosts_removed) || 0
      let ghost_note = ghosts > 0 ? ' ／ 倍音ゴースト' + ghosts + '個除去' : ''
      const Q = S.quantized!
      util.set_global_status(
        '変換完了：音符 ' +
          S.raw_notes.length +
          '個 / ' +
          Q.measure_count +
          '小節 / テンポ ' +
          Q.bpm +
          '（' +
          Q.step_label +
          '）' +
          (cache.engine === 'hires'
            ? ' ／ 高精度ピアノAI'
            : ' ／ 標準エンジン') +
          (cache.backend ? '（' + cache.backend.toUpperCase() + '）' : '') +
          ghost_note,
        'ok',
      )
      util.toast('変換が完了しました')
      save_history()
      player.preload(S.raw_notes)
    }
  } catch (err) {
    util.set_progress(0, '失敗')
    util.set_global_status('変換に失敗: ' + util.err_text(err), 'error')
    util.toast('変換に失敗しました')
  } finally {
    S.busy = false
    release_wake_lock()
    release_busy_lock()
    stop_keepalive()
    set_title_progress(null)
    util.el('btn_convert').disabled = false
    util.set_status(has_result() ? '変換済み' : '待機中')
  }
}
on(util.el('btn_convert'), 'click', convert)

on(util.el('btn_prev_page'), 'click', function () {
  if (!has_result() || S.page_index <= 0) return
  S.page_index--
  score.render_page()
})
on(util.el('btn_next_page'), 'click', function () {
  if (!has_result() || S.page_index >= S.page_count - 1) return
  S.page_index++
  score.render_page()
})
on(util.el('btn_zoom_in'), 'click', function () {
  if (!has_result()) return
  S.zoom = util.clamp(S.zoom * 1.15, 0.5, 2)
  score.render_page()
})
on(util.el('btn_zoom_out'), 'click', function () {
  if (!has_result()) return
  S.zoom = util.clamp(S.zoom / 1.15, 0.5, 2)
  score.render_page()
})
on(util.el('btn_zoom_fit'), 'click', function () {
  if (!has_result()) return
  S.zoom = score.default_zoom()
  score.render_page()
})

let resize_timer = 0
on(window, 'resize', function () {
  clearTimeout(resize_timer)
  resize_timer = setTimeout(function () {
    if (has_result()) score.render_page()
  }, 260)
})

let raf = 0
function update_transport() {
  let pos = S.playing ? player.position() : S.play_pos
  pos = util.clamp(pos, 0, S.duration || 0)
  util.el('transport_time').textContent =
    util.fmt_time(pos) + ' / ' + util.fmt_time(S.duration || 0)
  if (!S.playing && has_result()) {
    score.update_playhead(pos, false)
  }
}

function frame_loop() {
  update_transport()
  roll.draw()
  if (S.playing) {
    score.update_playhead(player.position(), util.input('chk_follow').checked)
    raf = requestAnimationFrame(frame_loop)
  }
}
function stop_frame_loop() {
  cancelAnimationFrame(raf)
  raf = 0
}

let loading_samples = false
on(util.el('btn_play'), 'click', async function () {
  if (!has_result()) {
    util.toast('先に変換してください')
    return
  }
  if (!S.raw_notes.length) {
    util.toast('再生できる音符がありません')
    return
  }
  if (S.playing || loading_samples) return
  loading_samples = true
  try {
    await player.preload(S.raw_notes, function (done, total: number) {
      util.set_status('ピアノ音源を読み込み中… ' + done + '/' + total)
    })
  } catch (e) {}
  loading_samples = false
  util.set_status('変換済み')
  player.play()
  stop_frame_loop()
  frame_loop()
})
on(util.el('btn_pause'), 'click', function () {
  if (!S.playing) return
  player.pause()
  stop_frame_loop()
  update_transport()
  roll.draw()
})
on(util.el('btn_stop'), 'click', function () {
  player.stop()
  stop_frame_loop()
  util.el('playhead').classList.add('is-hidden')
  update_transport()
  roll.draw()
  if (has_result() && S.page_index !== 0) {
    S.page_index = 0
    score.render_page()
  }
})
player.set_on_end(function () {
  stop_frame_loop()
  util.el('playhead').classList.add('is-hidden')
  update_transport()
  roll.draw()
})

function need_result() {
  if (!has_result()) {
    util.toast('先に変換してください')
    return false
  }
  return true
}
on(util.el('btn_dl_xml'), 'click', function () {
  if (!need_result()) return
  let xml = musicxml.build(S.quantized!)
  util.download_blob(
    new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }),
    cache.base_name + '.musicxml',
  )
  util.toast('MusicXMLを保存しました')
})
on(util.el('btn_dl_midi'), 'click', function () {
  if (!need_result()) return
  util.download_blob(
    midi.build_quantized(S.quantized!),
    cache.base_name + '_楽譜どおり.mid',
  )
  util.toast('MIDI（楽譜どおり）を保存しました')
})
on(util.el('btn_dl_midi_raw'), 'click', function () {
  if (!need_result()) return
  util.download_blob(
    midi.build_raw(S.raw_notes, S.quantized!.bpm),
    cache.base_name + '_演奏どおり.mid',
  )
  util.toast('MIDI（演奏どおり）を保存しました')
})
on(util.el('btn_dl_pdf'), 'click', async function () {
  if (!need_result()) return
  if (S.busy) {
    util.toast('処理中です。少し待ってください')
    return
  }
  S.busy = true
  try {
    let blob = await score.export_pdf(function (ratio: number, text: string) {
      util.set_progress(ratio, text)
    })
    if (blob) {
      util.download_blob(blob, cache.base_name + '.pdf')
      util.toast('PDFを保存しました')
    }
  } catch (e) {
    util.toast('PDFの作成に失敗しました')
    util.set_global_status('PDF失敗: ' + util.err_text(e), 'error')
  } finally {
    S.busy = false
  }
})

on(window, 'keydown', function (e) {
  const tgt = e.target as HTMLElement | null
  const tag = tgt ? tgt.tagName : ''
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if ((e as KeyboardEvent).key === ' ') {
    e.preventDefault()
    if (S.playing) util.el('btn_pause').click()
    else util.el('btn_play').click()
  } else if ((e as KeyboardEvent).key === 'ArrowLeft') {
    util.el('btn_prev_page').click()
  } else if ((e as KeyboardEvent).key === 'ArrowRight') {
    util.el('btn_next_page').click()
  }
})

roll.init()
render_history()
util.el('in_bpm').disabled = util.select('sel_bpm_mode').value !== 'manual'
util.el('in_split').disabled = util.select('sel_split_mode').value !== 'manual'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {})

  if (!window.crossOriginIsolated) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (S.busy) return
      if (sessionStorage.getItem('coi_reloaded')) return
      try {
        sessionStorage.setItem('coi_reloaded', '1')
      } catch (e) {}
      location.reload()
    })
  } else {
    try {
      sessionStorage.removeItem('coi_reloaded')
    } catch (e) {}
  }
}
