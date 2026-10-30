var S = {
  source_file: null,
  source_name: '',
  source_url: '',
  media_recorder: null,
  record_chunks: [],
  record_blob: null,
  raw_notes: [],
  quantized: null,
  duration: 0,
  busy: false,
  page_index: 0,
  page_count: 1,
  zoom: 1,
  measure_boxes: [],
  playing: false,
  play_pos: 0,
}
var presets = {
  piano: {
    label: '\u30D4\u30A2\u30CE',
    precision: { onset: 0.5, frame: 0.3, min_frames: 11 },
    recall: { onset: 0.24, frame: 0.15, min_frames: 5 },
    merge_ms: 55,
    min_dur: 0.03,
    min_amp: 0.035,
    recall_floor: 0.32,
    ghost_filter: false,
  },
  melody: {
    label: '\u5358\u4F53\u697D\u5668\u30FB\u30E1\u30ED\u30C7\u30A3',
    precision: { onset: 0.4, frame: 0.28, min_frames: 8 },
    recall: { onset: 0.25, frame: 0.16, min_frames: 5 },
    merge_ms: 70,
    min_dur: 0.045,
    min_amp: 0.06,
    recall_floor: 0.4,
    ghost_filter: true,
  },
  guitar: {
    label: '\u30AE\u30BF\u30FC',
    precision: { onset: 0.35, frame: 0.25, min_frames: 7 },
    recall: { onset: 0.22, frame: 0.15, min_frames: 5 },
    merge_ms: 60,
    min_dur: 0.04,
    min_amp: 0.05,
    recall_floor: 0.38,
    ghost_filter: true,
  },
  dense: {
    label: '\u6B4C\u5165\u308A\u30FB\u8907\u96D1',
    precision: { onset: 0.55, frame: 0.32, min_frames: 11 },
    recall: { onset: 0.35, frame: 0.22, min_frames: 8 },
    merge_ms: 70,
    min_dur: 0.05,
    min_amp: 0.07,
    recall_floor: 0.5,
    ghost_filter: true,
  },
}
var DIV = 24

var on_record_done = null
function set_on_record_done(fn) {
  on_record_done = fn
}
var TARGET_RATE = 22050
var _ctx = null
function ctx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return _ctx
}
async function decode(file, vocal_cut, rate) {
  let buf = await file.arrayBuffer()
  let decoded = await ctx().decodeAudioData(buf)
  let duration = decoded.duration
  let mono
  if (vocal_cut && decoded.numberOfChannels >= 2) {
    let l = decoded.getChannelData(0)
    let r = decoded.getChannelData(1)
    mono = new Float32Array(l.length)
    for (let i3 = 0; i3 < l.length; i3++) mono[i3] = (l[i3] - r[i3]) * 0.5
  } else if (decoded.numberOfChannels >= 2) {
    let l2 = decoded.getChannelData(0)
    let r2 = decoded.getChannelData(1)
    mono = new Float32Array(l2.length)
    for (let j = 0; j < l2.length; j++) mono[j] = (l2[j] + r2[j]) * 0.5
  } else {
    mono = decoded.getChannelData(0)
  }
  let target = rate || TARGET_RATE
  let samples2
  if (decoded.sampleRate === target) {
    samples2 = new Float32Array(mono)
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
    samples2 = new Float32Array(rendered.getChannelData(0))
  }
  preprocess(samples2)
  return { samples: samples2, duration }
}
function preprocess(samples2) {
  let n = samples2.length
  let x1 = 0,
    y1 = 0,
    i3
  for (i3 = 0; i3 < n; i3++) {
    let x0 = samples2[i3]
    let y0 = x0 - x1 + 0.995 * y1
    samples2[i3] = y0
    x1 = x0
    y1 = y0
  }
  let peak = 0
  for (i3 = 0; i3 < n; i3++) {
    let a = Math.abs(samples2[i3])
    if (a > peak) peak = a
  }
  if (peak > 1e-6) {
    let gain = 0.95 / peak
    for (i3 = 0; i3 < n; i3++) samples2[i3] *= gain
  }
}
async function start_record() {
  let S3 = S
  let stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
  let mime = ''
  let candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (let i3 = 0; i3 < candidates.length; i3++) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i3])) {
      mime = candidates[i3]
      break
    }
  }
  S3.record_chunks = []
  S3.media_recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : void 0,
  )
  S3.media_recorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) S3.record_chunks.push(e.data)
  }
  const rec = S3.media_recorder
  if (!rec) return
  rec.onstop = function () {
    stream.getTracks().forEach(function (t) {
      t.stop()
    })
    S3.record_blob = new Blob(S3.record_chunks, {
      type: rec.mimeType || 'audio/webm',
    })
    if (on_record_done) on_record_done(S3.record_blob)
  }
  S3.media_recorder.start()
}
function stop_record() {
  let S3 = S
  if (S3.media_recorder && S3.media_recorder.state !== 'inactive') {
    if (S3.media_recorder) S3.media_recorder.stop()
  }
}
on_record_done = null

var BUILD_ID = 'mrma09tt'

var worker = null
var next_id = 1
var jobs = new Map()
function ensure() {
  if (worker) return worker
  const w = new Worker('dist/worker.js', { type: 'module' })
  w.onmessage = (e) => {
    const msg = e.data
    if (!msg) return
    const job = jobs.get(msg.id)
    if (!job) return
    if (msg.type === 'progress') {
      if (job.on_progress) job.on_progress(msg.ratio || 0, msg.text || '')
      return
    }
    jobs.delete(msg.id)
    if (msg.type === 'done') {
      job.resolve({
        precision: msg.precision || [],
        recall: msg.recall || [],
        ghosts_removed: msg.ghosts_removed || 0,
        backend: msg.backend,
        engine: msg.engine,
        quality: msg.quality,
      })
    } else {
      job.reject(
        new Error(
          msg.message ||
            '\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
        ),
      )
    }
  }
  w.onerror = () => {
    for (const [, job] of jobs)
      job.reject(
        new Error(
          '\u30EF\u30FC\u30AB\u30FC\u304C\u505C\u6B62\u3057\u307E\u3057\u305F',
        ),
      )
    jobs.clear()
    worker = null
  }
  worker = w
  return w
}
function plan(profile, quality) {
  if (profile === 'piano') return { engine: 'hires', rate: 16e3 }
  return { engine: 'bp', rate: 22050 }
}
function transcribe(samples2, preset, p, quality, on_progress) {
  return new Promise((resolve, reject) => {
    if (
      (p.engine === 'hires' && p.rate !== 16e3) ||
      (p.engine === 'bp' && p.rate !== 22050)
    ) {
      reject(
        new Error(
          '\u5185\u90E8\u30A8\u30E9\u30FC: \u30A8\u30F3\u30B8\u30F3\u3068\u30EC\u30FC\u30C8\u304C\u4E0D\u4E00\u81F4\uFF08' +
            p.engine +
            '/' +
            String(p.rate) +
            '\uFF09',
        ),
      )
      return
    }
    let w
    try {
      w = ensure()
    } catch (e) {
      reject(
        new Error(
          '\u3053\u306E\u74B0\u5883\u3067\u306F\u30EF\u30FC\u30AB\u30FC\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093',
        ),
      )
      return
    }
    const id = next_id++
    jobs.set(id, { resolve, reject, on_progress })
    w.postMessage(
      {
        type: 'transcribe',
        id,
        build: BUILD_ID,
        samples: samples2,
        engine: p.engine,
        rate: p.rate,
        quality,
        precision: preset.precision,
        recall: preset.recall,
      },
      [samples2.buffer],
    )
  })
}

var DB_NAME = 'minamoscore'
var DB_VER = 1
var MAX_ENTRIES = 30
var MAX_AUDIO_BYTES = 30 * 1024 * 1024
var _db = null
function open() {
  if (_db) return Promise.resolve(_db)
  return new Promise(function (resolve, reject) {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB \u975E\u5BFE\u5FDC'))
      return
    }
    let req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = function () {
      let db = req.result
      if (!db.objectStoreNames.contains('results')) {
        db.createObjectStore('results', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'id' })
      }
    }
    req.onsuccess = function () {
      _db = req.result
      _db.onclose = function () {
        _db = null
      }
      resolve(req.result)
    }
    req.onerror = function () {
      reject(req.error || new Error('DB\u3092\u958B\u3051\u307E\u305B\u3093'))
    }
  })
}
function _tx_done(tx) {
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () {
      resolve()
    }
    tx.onerror = function () {
      reject(tx.error)
    }
    tx.onabort = function () {
      reject(tx.error || new Error('aborted'))
    }
  })
}
function save(record, audio_blob) {
  return open().then(function (db) {
    let store_audio = !!(audio_blob && audio_blob.size <= MAX_AUDIO_BYTES)
    record.has_audio = store_audio
    record.audio_size = audio_blob ? audio_blob.size : 0
    function attempt(with_audio) {
      let tx = db.transaction(['results', 'audio'], 'readwrite')
      tx.objectStore('results').put(record)
      if (with_audio) {
        tx.objectStore('audio').put({
          id: record.id,
          blob: audio_blob,
          type: (audio_blob && audio_blob.type) || '',
        })
      }
      return _tx_done(tx)
    }
    return attempt(store_audio)
      .catch(function () {
        record.has_audio = false
        return attempt(false)
      })
      .catch(function () {
        return prune(Math.max(1, MAX_ENTRIES - 6)).then(function () {
          record.has_audio = false
          return attempt(false)
        })
      })
      .then(function () {
        return prune(MAX_ENTRIES)
      })
  })
}
function list() {
  return open().then(function (db) {
    return new Promise(function (resolve, reject) {
      const out = []
      const tx = db.transaction('results', 'readonly')
      const req = tx.objectStore('results').openCursor(null, 'prev')
      req.onsuccess = function () {
        const cur = req.result
        if (!cur) {
          resolve(out)
          return
        }
        const v = cur.value || {}
        out.push({
          id: v.id,
          name: v.name,
          created: v.created,
          duration: v.duration,
          notes_count: v.notes_count,
          has_audio: !!v.has_audio,
          quality: v.quality || '',
          backend: v.backend || '',
        })
        cur.continue()
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  })
}
function get(id) {
  return open().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(['results', 'audio'], 'readonly')
      const out = { record: null, audio: null }
      let r1 = tx.objectStore('results').get(id)
      r1.onsuccess = function () {
        out.record = r1.result || null
      }
      let r2 = tx.objectStore('audio').get(id)
      r2.onsuccess = function () {
        out.audio = r2.result || null
      }
      tx.oncomplete = function () {
        resolve(out)
      }
      tx.onerror = function () {
        reject(tx.error)
      }
    })
  })
}
function remove(id) {
  return open().then(function (db) {
    let tx = db.transaction(['results', 'audio'], 'readwrite')
    tx.objectStore('results').delete(id)
    tx.objectStore('audio').delete(id)
    return _tx_done(tx)
  })
}
function prune(keep) {
  return open().then(function (db) {
    return new Promise(function (resolve, reject) {
      let tx = db.transaction(['results', 'audio'], 'readwrite')
      let results = tx.objectStore('results')
      let audio = tx.objectStore('audio')
      let seen = 0
      let req = results.openCursor(null, 'prev')
      req.onsuccess = function () {
        let cur = req.result
        if (!cur) return
        seen++
        if (seen > keep) {
          results.delete(cur.primaryKey)
          audio.delete(cur.primaryKey)
        }
        cur.continue()
      }
      tx.oncomplete = function () {
        resolve()
      }
      tx.onerror = function () {
        reject(tx.error)
      }
    })
  })
}

var ui_cache = {}
function el(id) {
  let hit = ui_cache[id]
  if (!hit) {
    const found = document.getElementById(id)
    if (!found) {
      throw new Error('ui element missing: ' + id)
    }
    hit = found
    ui_cache[id] = hit
  }
  return hit
}
function qs(sel) {
  return document.querySelector(sel)
}
function on(target, ev, fn, opt) {
  target.addEventListener(ev, fn, opt)
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
var toast_timer = 0
function toast(msg) {
  const t = el('toast')
  t.textContent = msg
  t.classList.add('is-show')
  if (toast_timer) {
    window.clearTimeout(toast_timer)
  }
  toast_timer = window.setTimeout(function () {
    t.classList.remove('is-show')
  }, 2600)
}
function set_status(msg) {
  el('status_pill').textContent = msg
}
function set_global_status(msg, tone) {
  const box = el('global_status')
  box.textContent = msg
  box.className = 'global-status' + (tone ? ' is-' + tone : '')
}
var progress_text_memo = ''
function set_progress(ratio, text) {
  const pct = Math.round(clamp(ratio, 0, 1) * 100)
  el('progress_bar').style.width = pct + '%'
  if (text != null) {
    progress_text_memo = String(text).replace(
      /[\u2026\s]*\d+\s*[%\uFF05]\s*$/,
      '',
    )
  }
  el('progress_text').textContent =
    pct + '%' + (progress_text_memo ? '\u3000' + progress_text_memo : '')
}
function fmt_time(sec) {
  let s = sec
  if (!isFinite(s) || s < 0) {
    s = 0
  }
  const m2 = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m2 + ':' + (r < 10 ? '0' : '') + r
}
function download_blob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(function () {
    URL.revokeObjectURL(a.href)
  }, 4e3)
}
function median(arr) {
  if (!arr.length) {
    return 0
  }
  const s = arr.slice().sort(function (a, b) {
    return a - b
  })
  return s[s.length >> 1]
}
function percentile(arr, p) {
  if (!arr.length) {
    return 0
  }
  const s = arr.slice().sort(function (a, b) {
    return a - b
  })
  const idx = clamp(Math.floor(s.length * p), 0, s.length - 1)
  return s[idx]
}
var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midi_name(midi) {
  const p = Math.round(midi)
  return NAMES[((p % 12) + 12) % 12] + String(Math.floor(p / 12) - 1)
}
function err_text(e) {
  if (e instanceof Error) {
    return e.message
  }
  return String(e)
}
function input(id) {
  return el(id)
}
function select(id) {
  return el(id)
}
function h(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
function hbutton(cls, text) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  return b
}
function set_title(text, base) {
  document.title = text == null ? base : text + ' \u2013 ' + base
}
function is_visible() {
  return document.visibilityState === 'visible'
}
function on_visibility(fn) {
  document.addEventListener('visibilitychange', fn)
}

var PPQ = 480
function _varlen(v) {
  let bytes = [v & 127]
  v >>= 7
  while (v > 0) {
    bytes.unshift((v & 127) | 128)
    v >>= 7
  }
  return bytes
}
function _str_bytes(s) {
  const out = []
  for (let i3 = 0; i3 < s.length; i3++) out.push(s.charCodeAt(i3) & 255)
  return out
}
function _build_smf(events, bpm) {
  events.sort(function (a, b) {
    return a.tick - b.tick
  })
  let track = []
  let uspq = Math.round(6e7 / bpm)
  track = track.concat([
    0,
    255,
    81,
    3,
    (uspq >> 16) & 255,
    (uspq >> 8) & 255,
    uspq & 255,
  ])
  track = track.concat([0, 192, 0])
  let last_tick = 0
  for (let i3 = 0; i3 < events.length; i3++) {
    let e = events[i3]
    let delta = Math.max(0, e.tick - last_tick)
    track = track.concat(_varlen(delta), e.bytes)
    last_tick = e.tick
  }
  track = track.concat([0, 255, 47, 0])
  let header = _str_bytes('MThd').concat([
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    (PPQ >> 8) & 255,
    PPQ & 255,
  ])
  let track_len = track.length
  let chunk = _str_bytes('MTrk').concat([
    (track_len >>> 24) & 255,
    (track_len >>> 16) & 255,
    (track_len >>> 8) & 255,
    track_len & 255,
  ])
  return new Blob([new Uint8Array(header.concat(chunk, track))], {
    type: 'audio/midi',
  })
}
function build_quantized(quantized) {
  let scale = PPQ / DIV
  let events = []
  for (const staff of [1, 2]) {
    let chords = quantized.staves[staff]
    for (let c = 0; c < chords.length; c++) {
      let ch = chords[c]
      for (let p = 0; p < ch.pitches.length; p++) {
        let note = ch.pitches[p]
        events.push({
          tick: Math.round(ch.tick * scale),
          bytes: [144, note.pitch, clamp(note.velocity, 1, 127)],
        })
        events.push({
          tick: Math.round((ch.tick + ch.dur) * scale),
          bytes: [128, note.pitch, 0],
        })
      }
    }
  }
  return _build_smf(events, quantized.bpm)
}
function build_raw(raw_notes, bpm) {
  let quarter = 60 / bpm
  let events = []
  for (let i3 = 0; i3 < raw_notes.length; i3++) {
    let n = raw_notes[i3]
    let on3 = Math.round((n.start / quarter) * PPQ)
    let off = Math.round(((n.start + n.dur) / quarter) * PPQ)
    if (off <= on3) off = on3 + 1
    events.push({
      tick: on3,
      bytes: [144, n.pitch, clamp(n.velocity || 80, 1, 127)],
    })
    events.push({ tick: off, bytes: [128, n.pitch, 0] })
  }
  return _build_smf(events, bpm)
}

var _dp = null
var _dp_cnt = null
var _dp_limit = 0
var i = 0
var STEP_LABELS = {
  12: '8\u5206',
  6: '16\u5206',
  3: '32\u5206',
  8: '8\u52063\u9023',
  4: '16\u52063\u9023',
}
var PIECES = [
  { div: 96, type: 'whole', dots: 0 },
  { div: 72, type: 'half', dots: 1 },
  { div: 48, type: 'half', dots: 0 },
  { div: 36, type: 'quarter', dots: 1 },
  { div: 24, type: 'quarter', dots: 0 },
  { div: 18, type: 'eighth', dots: 1 },
  { div: 16, type: 'quarter', dots: 0, tuplet: true },
  { div: 12, type: 'eighth', dots: 0 },
  { div: 9, type: '16th', dots: 1 },
  { div: 8, type: 'eighth', dots: 0, tuplet: true },
  { div: 6, type: '16th', dots: 0 },
  { div: 4, type: '16th', dots: 0, tuplet: true },
  { div: 3, type: '32nd', dots: 0 },
]
var _decomp_cache = new Map()
function decompose(dur) {
  if (dur <= 0) return []
  let cache2 = _decomp_cache
  if (cache2.has(dur)) return cache2.get(dur)
  let pieces = PIECES
  let limit = Math.max(dur, 96 * 8)
  if (!_dp || _dp_limit < limit) {
    let dp = new Int16Array(limit + 1).fill(-1)
    let cnt = new Int16Array(limit + 1).fill(32767)
    cnt[0] = 0
    for (let n = 1; n <= limit; n++) {
      for (let pi = 0; pi < pieces.length; pi++) {
        let d = pieces[pi].div
        if (d <= n && cnt[n - d] + 1 < cnt[n]) {
          cnt[n] = cnt[n - d] + 1
          dp[n] = pi
        }
      }
    }
    _dp = dp
    _dp_cnt = cnt
    _dp_limit = limit
  }
  const result = []
  let rem = dur
  while (rem > 0) {
    let pi2 = _dp[rem]
    if (pi2 < 0) {
      let down = rem - 1
      while (down > 0 && _dp[down] < 0) down--
      if (down <= 0) break
      rem = down
      continue
    }
    result.push(pieces[pi2])
    rem -= pieces[pi2].div
  }
  result.sort(function (a, b) {
    return b.div - a.div
  })
  cache2.set(dur, result)
  return result
}
function is_decomposable(dur) {
  if (dur === 0) return true
  if (dur < 3) return false
  decompose(3)
  return dur <= _dp_limit && _dp[dur] >= 0
}
function span_ok(start, len, measure_div) {
  if (len <= 0) return len === 0
  let pos = start,
    rem = len
  while (rem > 0) {
    let me = (Math.floor(pos / measure_div) + 1) * measure_div
    let span = Math.min(rem, me - pos)
    if (!is_decomposable(span)) return false
    pos += span
    rem -= span
  }
  return true
}
function pick_grid(notes, bpm, phase) {
  let quarter = 60 / bpm
  function median_err(step) {
    let step_sec = (quarter * step) / DIV
    let errs = []
    for (let i3 = 0; i3 < notes.length; i3++) {
      let t = notes[i3].start - phase
      let snapped = Math.round(t / step_sec) * step_sec
      errs.push(Math.abs(t - snapped))
    }
    return median(errs)
  }
  let e12 = median_err(12),
    e6 = median_err(6),
    e3 = median_err(3)
  let e8 = median_err(8),
    e4 = median_err(4)
  let triplet_base = e8 < e6 * 0.72 && e8 < e12 * 0.72
  let base
  if (triplet_base) {
    base = e4 < e8 * 0.62 ? 4 : 8
  } else {
    base = 12
    if (e6 < e12 * 0.62) base = 6
    if (base === 6 && e3 < e6 * 0.62) base = 3
  }
  return base
}
function assemble(q_notes, meta) {
  let opts = meta
  let bpm = meta.bpm,
    phase = meta.phase,
    quarter = meta.quarter_sec
  let base_step = meta.base_step,
    mixed = meta.mixed
  let measure_div = meta.measure_div,
    ts_num = meta.ts_num,
    ts_den = meta.ts_den
  for (let si = 0; si < q_notes.length; si++) {
    if (q_notes[si].staff == null) {
      q_notes[si].staff = q_notes[si].pitch >= meta.split ? 1 : 2
    }
  }
  if (opts.density === 'balanced' || opts.density === 'clean') {
    let cap = opts.density === 'balanced' ? 12 : 6
    let by_tick = new Map()
    for (let j = 0; j < q_notes.length; j++) {
      let key = q_notes[j].staff + ':' + q_notes[j].tick
      if (!by_tick.has(key)) by_tick.set(key, [])
      by_tick.get(key).push(q_notes[j])
    }
    let kept = []
    by_tick.forEach(function (group) {
      group.sort(function (a, b) {
        return b.amp - a.amp
      })
      for (let k = 0; k < Math.min(group.length, cap); k++) kept.push(group[k])
    })
    if (opts.density === 'clean') {
      kept = kept.filter(function (n2) {
        return n2.amp >= 0.06
      })
    }
    q_notes = kept
  }
  q_notes.sort(function (a, b) {
    return (
      a.tick - b.tick || (a.staff || 0) - (b.staff || 0) || a.pitch - b.pitch
    )
  })
  const note_staves = { 1: [], 2: [] }
  const staves = { 1: [], 2: [] }
  for (let m2 = 0; m2 < q_notes.length; m2++)
    note_staves[q_notes[m2].staff || 1].push(q_notes[m2])
  for (const staff of [1, 2]) {
    let tick_ok2 = function (prev_tick, tick) {
        let gap = tick - prev_tick
        if (gap < 0) return false
        if (gap > 0 && gap < 3) return false
        if (!span_ok(prev_tick, gap, measure_div)) return false
        let r = tick % measure_div
        let to_bar = measure_div - r
        if (r !== 0 && !is_decomposable(to_bar)) return false
        return true
      },
      pick_duration2 = function (tick, desired, room) {
        let limit =
          room === Infinity ? desired + 12 : Math.min(room, desired + 12)
        let best = -1,
          best_diff = Infinity
        for (let dd = 3; dd <= limit; dd++) {
          if (!span_ok(tick, dd, measure_div)) continue
          if (room !== Infinity) {
            let rest = room - dd
            if (rest !== 0) {
              if (rest < 3) continue
              if (!span_ok(tick + dd, rest, measure_div)) continue
            }
          } else {
            let end = tick + dd
            let tail = (Math.floor(end / measure_div) + 1) * measure_div - end
            if (tail !== measure_div && !is_decomposable(tail)) continue
          }
          let diff = Math.abs(dd - desired)
          if (diff < best_diff) {
            best_diff = diff
            best = dd
          }
          if (diff === 0) break
        }
        if (best > 0) return best
        if (room !== Infinity && span_ok(tick, room, measure_div)) return room
        return span_ok(tick, 4, measure_div) ? 4 : 3
      }
    var tick_ok = tick_ok2,
      pick_duration = pick_duration2
    const list2 = note_staves[staff]
    let chords = []
    for (let a = 0; a < list2.length; a++) {
      let last = chords[chords.length - 1]
      if (last && last.tick === list2[a].tick) {
        last.pitches.push({
          pitch: list2[a].pitch,
          velocity: list2[a].velocity,
        })
        if (list2[a].dur > last.dur) last.dur = list2[a].dur
      } else {
        chords.push({
          tick: list2[a].tick,
          dur: list2[a].dur,
          pitches: [{ pitch: list2[a].pitch, velocity: list2[a].velocity }],
        })
      }
    }
    let TICK_DELTAS = [0, 1, -1, 2, -2, 3, -3, 4, -4]
    for (let b = 0; b < chords.length; b++) {
      let prev_tick = b === 0 ? 0 : chords[b - 1].tick
      let fixed = false
      for (let d = 0; d < TICK_DELTAS.length; d++) {
        let cand = chords[b].tick + TICK_DELTAS[d]
        if (cand < prev_tick || cand < 0) continue
        if (tick_ok2(prev_tick, cand)) {
          chords[b].tick = cand
          fixed = true
          break
        }
      }
      if (!fixed && b > 0) chords[b].tick = prev_tick
      if (b > 0 && chords[b].tick === chords[b - 1].tick) {
        let prev = chords[b - 1]
        for (let pz = 0; pz < chords[b].pitches.length; pz++) {
          let exists = prev.pitches.some(function (pp) {
            return pp.pitch === chords[b].pitches[pz].pitch
          })
          if (!exists) prev.pitches.push(chords[b].pitches[pz])
        }
        if (chords[b].dur > prev.dur) prev.dur = chords[b].dur
        chords.splice(b, 1)
        b--
      }
    }
    for (let c2 = 0; c2 < chords.length; c2++) {
      let cur = chords[c2]
      let room =
        c2 + 1 < chords.length ? chords[c2 + 1].tick - cur.tick : Infinity
      let desired = room === Infinity ? cur.dur : Math.min(cur.dur, room)
      cur.dur = pick_duration2(cur.tick, Math.max(3, desired), room)
    }
    staves[staff] = chords
  }
  let total_ticks = 0
  for (const st of [1, 2]) {
    let list2 = staves[st]
    if (list2.length) {
      let last2 = list2[list2.length - 1]
      total_ticks = Math.max(total_ticks, last2.tick + last2.dur)
    }
  }
  let measure_count = Math.max(1, Math.ceil(total_ticks / measure_div))
  return {
    staves,
    bpm,
    phase,
    quarter_sec: quarter,
    base_step,
    mixed,
    step_label: STEP_LABELS[base_step] + (mixed ? '\uFF0B3\u9023' : ''),
    measure_div,
    measure_count,
    ts_num,
    ts_den,
    split: meta.split,
    beats: meta.beats || null,
    debug_resid: meta.debug_resid || null,
  }
}
function chordify(notes) {
  let sorted = notes.slice().sort(function (a, b) {
    return a.start - b.start
  })
  let groups = []
  for (let i3 = 0; i3 < sorted.length; i3++) {
    let g = groups[groups.length - 1]
    if (g && sorted[i3].start - g.t0 < 0.035) {
      g.notes.push(sorted[i3])
      g.t = g.t + (sorted[i3].start - g.t) / g.notes.length
    } else {
      groups.push({
        t0: sorted[i3].start,
        t: sorted[i3].start,
        notes: [sorted[i3]],
      })
    }
  }
  return groups
}
function locate_in_beats(t, beats) {
  let lo = 0,
    hi = beats.length - 1
  while (lo < hi - 1) {
    let mid = (lo + hi) >> 1
    if (beats[mid] <= t) lo = mid
    else hi = mid
  }
  let ibi = Math.max(1e-3, beats[lo + 1] - beats[lo])
  let u = (t - beats[lo]) / ibi
  if (u < 0) u = 0
  return { beat: lo, u, ibi }
}
function snap_u(u, step, ibi) {
  let frac = step / DIV
  let k = Math.round(u / frac)
  return { ticks: k * step, err: Math.abs(u - k * frac) * ibi }
}
function pick_grid_beats(groups, beats) {
  let cands = [
    { step: 12, pen: 4e-3 },
    { step: 6, pen: 0 },
    { step: 3, pen: 0.01 },
  ]
  let best = 6,
    best_score = 1e9
  for (let c = 0; c < cands.length; c++) {
    let errs = []
    for (let i3 = 0; i3 < groups.length; i3++) {
      let loc = locate_in_beats(groups[i3].t, beats)
      let s = snap_u(loc.u, cands[c].step, loc.ibi)
      let s3 = snap_u(loc.u, 8, loc.ibi)
      errs.push(Math.min(s.err, s3.err))
    }
    errs.sort(function (a, b) {
      return a - b
    })
    let med = errs.length ? errs[errs.length >> 1] : 0
    let score = med + cands[c].pen
    if (score < best_score) {
      best_score = score
      best = cands[c].step
    }
  }
  return best
}
function run_beats(notes, opts) {
  const beats = opts.beats
  let ts_num = opts.ts_num || 4
  let ts_den = opts.ts_den || 4
  let measure_div = Math.round((DIV * ts_num * 4) / ts_den)
  let groups = chordify(notes)
  let resid = []
  let base_step
  let mixed = false
  if (opts.grid === 'auto') {
    base_step = groups.length ? pick_grid_beats(groups, beats) : 6
    mixed = base_step === 6 || base_step === 12
  } else {
    base_step = parseInt(opts.grid, 10) || 6
    mixed = base_step === 6 || base_step === 12
  }
  let trip_step = base_step === 12 ? 8 : 4
  const q_notes = []
  for (let i3 = 0; i3 < groups.length; i3++) {
    let g = groups[i3]
    let loc = locate_in_beats(g.t, beats)
    let sb = snap_u(loc.u, base_step, loc.ibi)
    let ticks_in = sb.ticks,
      step_used = base_step,
      used_err = sb.err
    if (mixed) {
      let st3 = snap_u(loc.u, trip_step, loc.ibi)
      if (st3.err < sb.err * 0.55) {
        ticks_in = st3.ticks
        step_used = trip_step
        used_err = st3.err
      }
    }
    resid.push(used_err)
    let tick = loc.beat * DIV + ticks_in
    for (let k = 0; k < g.notes.length; k++) {
      let n = g.notes[k]
      let e = locate_in_beats(n.start + n.dur, beats)
      let se = snap_u(e.u, step_used, e.ibi)
      let tick_end = e.beat * DIV + se.ticks
      let dur_ticks = Math.max(step_used, tick_end - tick)
      dur_ticks = Math.min(dur_ticks, measure_div * 2)
      q_notes.push({
        tick,
        dur: dur_ticks,
        pitch: n.pitch,
        velocity: n.velocity || Math.round((n.amp || 0.5) * 127),
        amp: n.amp,
        step: step_used,
      })
    }
  }
  q_notes.sort(function (a, b) {
    return a.tick - b.tick || a.pitch - b.pitch
  })
  let dedup = []
  for (i = 0; i < q_notes.length; i++) {
    let prev = dedup[dedup.length - 1]
    if (
      prev &&
      prev.tick === q_notes[i].tick &&
      prev.pitch === q_notes[i].pitch
    ) {
      prev.dur = Math.max(prev.dur, q_notes[i].dur)
      prev.velocity = Math.max(prev.velocity, q_notes[i].velocity)
    } else {
      dedup.push(q_notes[i])
    }
  }
  let ibis = []
  for (i = 1; i < beats.length; i++) ibis.push(beats[i] - beats[i - 1])
  ibis.sort(function (a, b) {
    return a - b
  })
  let med_ibi = ibis.length ? ibis[ibis.length >> 1] : 0.5
  let bpm = Math.max(30, Math.min(300, Math.round(60 / med_ibi)))
  return assemble(dedup, {
    bpm,
    phase: beats[0] || 0,
    quarter_sec: med_ibi,
    base_step,
    mixed,
    measure_div,
    ts_num,
    ts_den,
    split: opts.split,
    density: opts.density,
    beats,
    debug_resid: resid,
  })
}
function run(notes, opts) {
  if (opts.beats && opts.beats.length >= 2) return run_beats(notes, opts)
  let bpm = opts.bpm
  let phase = opts.phase
  let quarter = 60 / bpm
  let ts_num = opts.ts_num || 4
  let ts_den = opts.ts_den || 4
  let measure_div = Math.round((DIV * ts_num * 4) / ts_den)
  let base_step
  let mixed = false
  if (opts.grid === 'auto') {
    base_step = notes.length ? pick_grid(notes, bpm, phase) : 6
    mixed = base_step === 6 || base_step === 12
  } else {
    base_step = parseInt(opts.grid, 10) || 6
  }
  let trip_step = base_step === 12 ? 8 : 4
  function snap(t, step) {
    let step_sec = (quarter * step) / DIV
    let tick = Math.round((t - phase) / step_sec) * step
    return {
      tick: Math.max(0, tick),
      err: Math.abs(t - phase - Math.round((t - phase) / step_sec) * step_sec),
    }
  }
  const q_notes = []
  for (let i3 = 0; i3 < notes.length; i3++) {
    let n = notes[i3]
    let s_base = snap(n.start, base_step)
    let tick = s_base.tick
    let step_used = base_step
    if (mixed) {
      let s_trip = snap(n.start, trip_step)
      if (s_trip.err < s_base.err * 0.55) {
        tick = s_trip.tick
        step_used = trip_step
      }
    }
    let dur_ticks = Math.max(
      step_used,
      Math.round(n.dur / (quarter / DIV) / step_used) * step_used,
    )
    dur_ticks = Math.min(dur_ticks, measure_div * 2)
    q_notes.push({
      tick,
      dur: dur_ticks,
      pitch: n.pitch,
      velocity: n.velocity || 80,
      staff: n.staff || 1,
      src_start: n.start,
      src_dur: n.dur,
      amp: n.amp,
    })
  }
  return assemble(q_notes, {
    bpm,
    phase,
    quarter_sec: quarter,
    base_step,
    mixed,
    measure_div,
    ts_num,
    ts_den,
    split: opts.split,
    density: opts.density,
  })
}

var PITCH_STEPS = [
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
function pitch_xml(midi) {
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
function segment_chord(chord, measure_div) {
  const segs = []
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
  for (let i3 = 0; i3 < segs.length - 1; i3++) segs[i3].tie_start = true
  return segs
}
function chord_segment_xml(seg, pitches, voice, staff) {
  const pieces = decompose(seg.dur)
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
function rest_xml(dur, voice, staff) {
  const pieces = decompose(dur) || []
  let xml = ''
  for (let i3 = 0; i3 < pieces.length; i3++) {
    let piece = pieces[i3]
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
function staff_measure_xml(segments, measure_start, measure_div, voice, staff) {
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
  for (let i3 = 0; i3 < segments.length; i3++) {
    let s = segments[i3]
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
function layout_measures(quantized) {
  let md = quantized.measure_div
  let count = quantized.measure_count
  const layout2 = []
  for (let i3 = 0; i3 < count; i3++) layout2.push({ 1: [], 2: [] })
  for (const staff of [1, 2]) {
    let chords = quantized.staves[staff]
    for (let c = 0; c < chords.length; c++) {
      let segs = segment_chord(chords[c], md)
      for (let s = 0; s < segs.length; s++) {
        let mi = Math.floor(segs[s].tick / md)
        if (mi >= count) continue
        layout2[mi][staff].push({
          tick: segs[s].tick,
          dur: segs[s].dur,
          tie_start: segs[s].tie_start,
          tie_stop: segs[s].tie_stop,
          pitches: chords[c].pitches,
        })
      }
    }
    for (let m2 = 0; m2 < count; m2++) {
      layout2[m2][staff].sort(function (a, b) {
        return a.tick - b.tick
      })
    }
  }
  return layout2
}
function build(quantized, opts) {
  let from = opts && opts.from != null ? opts.from : 0
  let to = opts && opts.to != null ? opts.to : quantized.measure_count
  from = clamp(from, 0, quantized.measure_count)
  to = clamp(to, from, quantized.measure_count)
  let layout2 = opts && opts.layout ? opts.layout : layout_measures(quantized)
  let md = quantized.measure_div
  let measures_xml = ''
  for (let m2 = from; m2 < to; m2++) {
    let num = m2 - from + 1
    let attrs = ''
    if (m2 === from) {
      attrs =
        '<attributes><divisions>' +
        DIV +
        '</divisions><key><fifths>0</fifths></key><time><beats>' +
        quantized.ts_num +
        '</beats><beat-type>' +
        quantized.ts_den +
        '</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' +
        quantized.bpm +
        '</per-minute></metronome></direction-type><sound tempo="' +
        quantized.bpm +
        '"/></direction>'
    }
    let measure_start = m2 * md
    let right = staff_measure_xml(layout2[m2][1], measure_start, md, 1, 1)
    let left = staff_measure_xml(layout2[m2][2], measure_start, md, 2, 2)
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
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' +
    measures_xml +
    '</part></score-partwise>'
  )
}

function union_passes(precision, recall, preset) {
  const result = precision.slice()
  if (!recall.length) return result
  let p_amps = precision.map(function (n) {
    return n.amp
  })
  let amp_median = p_amps.length ? median(p_amps) : 0.2
  let floor = Math.max(preset.min_amp, amp_median * preset.recall_floor)
  let by_pitch = new Map()
  for (let i3 = 0; i3 < precision.length; i3++) {
    let p = precision[i3]
    if (!by_pitch.has(p.pitch)) by_pitch.set(p.pitch, [])
    by_pitch.get(p.pitch).push(p)
  }
  let dup_sec = (preset.dup_ms != null ? preset.dup_ms : 50) / 1e3
  let added = 0
  for (let j = 0; j < recall.length; j++) {
    let r = recall[j]
    if (r.amp < floor) continue
    let peers = by_pitch.get(r.pitch)
    let dup = false
    if (peers) {
      for (let k = 0; k < peers.length; k++) {
        let q = peers[k]
        let ov =
          Math.min(q.start + q.dur, r.start + r.dur) -
          Math.max(q.start, r.start)
        if (
          ov > 0.5 * Math.min(q.dur, r.dur) ||
          Math.abs(q.start - r.start) < dup_sec
        ) {
          dup = true
          break
        }
      }
    }
    if (!dup) {
      result.push(r)
      if (!peers) {
        peers = []
        by_pitch.set(r.pitch, peers)
      }
      peers.push(r)
      added++
    }
  }
  result.added_by_recall = added
  return result
}
function clean(notes, preset) {
  let out = notes.filter(function (n) {
    return n.dur >= preset.min_dur * 0.7 && n.amp >= preset.min_amp * 0.7
  })
  out.sort(function (a, b) {
    return a.pitch - b.pitch || a.start - b.start
  })
  let merge_sec = preset.merge_ms / 1e3
  const merged = []
  for (let i3 = 0; i3 < out.length; i3++) {
    let n = out[i3]
    let last = merged[merged.length - 1]
    if (last && last.pitch === n.pitch) {
      let gap = n.start - (last.start + last.dur)
      if (gap < merge_sec && gap > -0.5) {
        let end = Math.max(last.start + last.dur, n.start + n.dur)
        last.dur = end - last.start
        if (n.amp > last.amp) {
          last.amp = n.amp
          if (n.velocity != null) last.velocity = n.velocity
        }
        continue
      }
      if (n.start < last.start + last.dur) {
        last.dur = Math.max(0.02, n.start - last.start)
      }
    }
    const kept = {
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      amp: n.amp,
    }
    if (n.velocity != null) kept.velocity = n.velocity
    merged.push(kept)
  }
  let final_notes = merged
  if (preset.ghost_filter) {
    final_notes = merged.filter(function (n) {
      for (let j = 0; j < merged.length; j++) {
        let m2 = merged[j]
        if (m2 === n) continue
        if (
          Math.abs(m2.start - n.start) < 0.03 &&
          Math.abs(m2.pitch - n.pitch) === 12 &&
          n.amp < m2.amp * 0.28
        ) {
          return false
        }
      }
      return true
    })
  }
  final_notes.sort(function (a, b) {
    return a.start - b.start || a.pitch - b.pitch
  })
  return final_notes
}
function assign_velocity(notes) {
  if (!notes.length) return notes
  let missing = notes.filter(function (n) {
    return n.velocity == null
  })
  if (!missing.length) return notes
  let amps = missing.map(function (n) {
    return n.amp
  })
  let ref = Math.max(0.05, percentile(amps, 0.95))
  for (let i3 = 0; i3 < missing.length; i3++) {
    let rel = clamp(missing[i3].amp / ref, 0, 1)
    missing[i3].velocity = clamp(
      Math.round(22 + Math.pow(rel, 0.6) * 100),
      1,
      127,
    )
  }
  return notes
}
function split_hands(notes, split_mode, manual_split) {
  let split
  if (split_mode === 'manual') {
    split = clamp(manual_split | 0, 36, 84)
  } else {
    if (!notes.length) {
      split = 60
    } else {
      let pitches = notes
        .map(function (n) {
          return n.pitch
        })
        .sort(function (a, b) {
          return a - b
        })
      let med = median(pitches)
      let lo = clamp(Math.round(med) - 12, 43, 76)
      let hi = clamp(Math.round(med) + 12, 44, 77)
      let hist = new Array(128).fill(0)
      for (let i3 = 0; i3 < pitches.length; i3++) hist[pitches[i3]]++
      let best = 60,
        best_score = -Infinity
      for (let c = lo; c <= hi; c++) {
        let density = hist[c] + hist[c - 1] + hist[c + 1]
        let score = -density - Math.abs(c - 60) * 0.15
        if (score > best_score) {
          best_score = score
          best = c
        }
      }
      split = best
    }
  }
  for (let j = 0; j < notes.length; j++) {
    notes[j].staff = notes[j].pitch >= split ? 1 : 2
  }
  return split
}
function build2(precision, recall, preset, split_mode, manual_split) {
  let unioned = union_passes(precision, recall, preset)
  let cleaned = clean(unioned, preset)
  assign_velocity(cleaned)
  let split = split_hands(cleaned, split_mode, manual_split)
  return {
    notes: cleaned,
    split,
    added_by_recall: unioned.added_by_recall || 0,
  }
}

var master = null
var start_ctx_time = 0
var start_pos = 0
var scheduler = 0
var scheduled_index = 0
var sorted_notes = []
var on_end = null
function set_on_end(fn) {
  on_end = fn
}
var SAMPLE_BASE =
  'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/acoustic_grand_piano-mp3/'
var samples = new Map()
var sample_loading = new Map()
var sample_failed = new Set()
var force_synth = false
function sample_name(pitch) {
  let NAMES2 = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
  let octave = Math.floor(pitch / 12) - 1
  return NAMES2[pitch % 12] + octave
}
function _load_sample(pitch) {
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
      return ctx().decodeAudioData(buf)
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
function preload(notes, on_progress) {
  let pitches = []
  let seen = new Set()
  for (let i3 = 0; i3 < notes.length; i3++) {
    let p = notes[i3].pitch
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
      _load_sample(p).then(function (success) {
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
function _nearest_sample(pitch) {
  if (samples.has(pitch)) return { pitch, buf: samples.get(pitch) }
  for (let d = 1; d <= 5; d++) {
    if (samples.has(pitch - d))
      return { pitch: pitch - d, buf: samples.get(pitch - d) }
    if (samples.has(pitch + d))
      return { pitch: pitch + d, buf: samples.get(pitch + d) }
  }
  return null
}
function _ensure_master() {
  let ctx3 = ctx()
  if (ctx3.state === 'suspended') ctx3.resume()
  if (!master) {
    let comp = ctx3.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 6
    let gain = ctx3.createGain()
    gain.gain.value = 0.8
    gain.connect(comp)
    comp.connect(ctx3.destination)
    master = gain
  }
  return ctx()
}
function _schedule_sample(ctx3, note, when, hit) {
  let vel = (note.velocity || 80) / 127
  let dur = Math.max(0.06, note.dur)
  let src = ctx3.createBufferSource()
  src.buffer = hit.buf || null
  if (hit.pitch !== note.pitch) {
    src.playbackRate.value = Math.pow(2, (note.pitch - hit.pitch) / 12)
  }
  let filt = ctx3.createBiquadFilter()
  filt.type = 'lowpass'
  filt.frequency.value = 1400 + vel * 9e3
  filt.Q.value = 0.4
  let env = ctx3.createGain()
  let g = 0.22 + 0.78 * Math.pow(vel, 1.4)
  env.gain.setValueAtTime(g, when)
  let t_end = when + dur
  env.gain.setTargetAtTime(1e-4, t_end, 0.1)
  src.connect(filt)
  filt.connect(env)
  env.connect(master)
  src.start(when)
  src.stop(t_end + 0.6)
}
function _schedule_synth(ctx3, note, when) {
  let freq = 440 * Math.pow(2, (note.pitch - 69) / 12)
  let vel = (note.velocity || 80) / 127
  let dur = Math.max(0.06, note.dur)
  let osc1 = ctx3.createOscillator()
  osc1.type = 'triangle'
  osc1.frequency.value = freq
  let osc2 = ctx3.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.value = freq * 2
  let filt = ctx3.createBiquadFilter()
  filt.type = 'lowpass'
  filt.frequency.value = 700 + vel * 3400
  filt.Q.value = 0.5
  let g1 = ctx3.createGain()
  let g2 = ctx3.createGain()
  g2.gain.value = 0.22
  let env = ctx3.createGain()
  osc1.connect(g1)
  osc2.connect(g2)
  g1.connect(filt)
  g2.connect(filt)
  filt.connect(env)
  env.connect(master)
  let peak = 0.06 + vel * 0.32
  let attack = 4e-3
  let release = 0.09
  let sustain_end = when + dur
  env.gain.setValueAtTime(1e-4, when)
  env.gain.linearRampToValueAtTime(peak, when + attack)
  env.gain.setTargetAtTime(
    peak * 0.25,
    when + attack,
    Math.max(0.12, dur * 0.5),
  )
  env.gain.setTargetAtTime(1e-4, sustain_end, release / 3)
  osc1.start(when)
  osc2.start(when)
  let stop_at = sustain_end + release + 0.05
  osc1.stop(stop_at)
  osc2.stop(stop_at)
}
function _schedule_note(ctx3, note, when) {
  if (!force_synth) {
    let hit = _nearest_sample(note.pitch)
    if (hit) {
      _schedule_sample(ctx3, note, when, hit)
      return
    }
  }
  _schedule_synth(ctx3, note, when)
}
function position() {
  if (!S.playing) return start_pos
  let ctx3 = ctx()
  return start_pos + (ctx3.currentTime - start_ctx_time)
}
function play(from_sec) {
  let S3 = S
  if (!S3.raw_notes.length) return
  stop(true)
  let ctx3 = _ensure_master()
  let pos = clamp(from_sec != null ? from_sec : S3.play_pos, 0, S3.duration)
  if (pos >= S3.duration - 0.05) pos = 0
  sorted_notes = S3.raw_notes.slice().sort(function (a, b) {
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
  start_ctx_time = ctx3.currentTime + 0.06
  S3.playing = true
  S3.play_pos = pos
  let lookahead = 0.6
  let tick = function () {
    if (!S3.playing) return
    let now_pos = position()
    let horizon = now_pos + lookahead
    let list2 = sorted_notes
    while (
      scheduled_index < list2.length &&
      list2[scheduled_index].start <= horizon
    ) {
      let n = list2[scheduled_index]
      let when = start_ctx_time + (n.start - start_pos)
      if (when >= ctx3.currentTime - 0.01) {
        _schedule_note(ctx3, n, Math.max(ctx3.currentTime + 5e-3, when))
      }
      scheduled_index++
    }
    if (now_pos >= S3.duration + 0.4) {
      stop()
      if (on_end) on_end()
      return
    }
    scheduler = setTimeout(tick, 120)
  }
  tick()
}
function pause() {
  let S3 = S
  if (!S3.playing) return
  S3.play_pos = position()
  stop(true)
  S3.play_pos = clamp(S3.play_pos, 0, S3.duration)
}
function stop(keep_pos) {
  let S3 = S
  clearTimeout(scheduler)
  if (master) {
    let ctx3 = ctx()
    let g = master.gain
    g.cancelScheduledValues(ctx3.currentTime)
    g.setValueAtTime(g.value, ctx3.currentTime)
    g.linearRampToValueAtTime(1e-4, ctx3.currentTime + 0.06)
    let old_master = master
    setTimeout(function () {
      try {
        old_master.disconnect()
      } catch (e) {}
    }, 120)
    master = null
  }
  S3.playing = false
  if (!keep_pos) S3.play_pos = 0
}
function seek(sec) {
  let S3 = S
  let was_playing = S3.playing
  S3.play_pos = clamp(sec, 0, S3.duration)
  if (was_playing) {
    play(S3.play_pos)
  }
}

var canvas = null
var ctx2 = null
var pitch_min = 36
var pitch_max = 84
var on_seek = null
function init() {
  canvas = el('roll_canvas')
  ctx2 = canvas.getContext('2d')
  const seek_from_event = function (e) {
    const S3 = S
    if (!S3.duration || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const t = clamp(x / rect.width, 0, 1) * S3.duration
    seek(t)
    draw()
    if (on_seek) on_seek()
  }
  canvas.addEventListener('pointerdown', seek_from_event)
  window.addEventListener('resize', function () {
    resize()
  })
  resize()
}
function resize() {
  let c = canvas
  if (!c) return
  let dpr = Math.max(1, window.devicePixelRatio || 1)
  let rect = c.getBoundingClientRect()
  let w = Math.max(200, Math.round(rect.width * dpr))
  let h2 = Math.round(160 * dpr)
  if (c.width !== w || c.height !== h2) {
    c.width = w
    c.height = h2
  }
  draw()
}
function set_range(notes) {
  if (!notes.length) {
    pitch_min = 36
    pitch_max = 84
    return
  }
  let lo = 127,
    hi = 0
  for (let i3 = 0; i3 < notes.length; i3++) {
    if (notes[i3].pitch < lo) lo = notes[i3].pitch
    if (notes[i3].pitch > hi) hi = notes[i3].pitch
  }
  pitch_min = Math.max(21, lo - 2)
  pitch_max = Math.min(108, hi + 2)
}
function draw() {
  const S3 = S
  const c = canvas
  const cx = ctx2
  if (!c || !cx) return
  const w = c.width,
    h2 = c.height
  cx.clearRect(0, 0, w, h2)
  if (!S3.raw_notes.length || !S3.duration) return
  let range = Math.max(1, pitch_max - pitch_min)
  let row_h = h2 / range
  cx.fillStyle = 'rgba(240, 220, 196, .5)'
  for (let p = pitch_min; p <= pitch_max; p++) {
    if (p % 12 === 0) {
      let gy = h2 - (p - pitch_min) * row_h
      cx.fillRect(0, gy - 1, w, 1)
    }
  }
  for (let i3 = 0; i3 < S3.raw_notes.length; i3++) {
    let n = S3.raw_notes[i3]
    let x = (n.start / S3.duration) * w
    let nw = Math.max(2, (n.dur / S3.duration) * w)
    let y = h2 - (n.pitch - pitch_min + 1) * row_h
    let alpha = 0.45 + clamp((n.velocity || 80) / 127, 0, 1) * 0.55
    cx.fillStyle =
      n.staff === 2
        ? 'rgba(66, 133, 190, ' + alpha + ')'
        : 'rgba(245, 122, 26, ' + alpha + ')'
    cx.fillRect(x, y, nw, Math.max(2, row_h - 1))
  }
  let pos = S3.playing ? position() : S3.play_pos
  let px = clamp(pos / S3.duration, 0, 1) * w
  cx.fillStyle = 'rgba(67, 48, 29, .16)'
  cx.fillRect(0, 0, px, h2)
  cx.fillStyle = '#d95f00'
  cx.fillRect(px - 1, 0, 3, h2)
}

var osmd = null
var hidden_osmd = null
var layout = null
var mpp = 4
var render_seq = 0
function init2() {
  if (osmd) return
  if (!window.opensheetmusicdisplay) {
    toast(
      '\u697D\u8B5C\u30E9\u30A4\u30D6\u30E9\u30EA\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
    )
    return
  }
  osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(
    el('sheet_host'),
    {
      backend: 'svg',
      autoResize: false,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawingParameters: 'compact',
    },
  )
}
function setup(quantized, mpp2) {
  let S3 = S
  layout = layout_measures(quantized)
  mpp2 = mpp2
  S3.page_count = Math.max(1, Math.ceil(quantized.measure_count / mpp2))
  S3.page_index = 0
  S3.zoom = default_zoom()
}
function default_zoom() {
  let frame = el('sheet_frame')
  let w = frame ? frame.clientWidth : 900
  return clamp(w / 980, 0.5, 1.25)
}
async function render_page() {
  let S3 = S
  let Q = S3.quantized
  if (!Q) return
  init2()
  if (!osmd) return
  let seq = ++render_seq
  let from = S3.page_index * mpp
  let to = Math.min(Q.measure_count, from + mpp)
  let xml = build(Q, {
    from,
    to,
    layout: layout || void 0,
  })
  try {
    await osmd.load(xml)
    if (seq !== render_seq) return
    osmd.zoom = S3.zoom
    osmd.render()
  } catch (e) {
    toast(
      '\u697D\u8B5C\u306E\u63CF\u753B\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
    )
    return
  }
  collect_measure_boxes(from, to)
  el('page_indicator').textContent = S3.page_index + 1 + ' / ' + S3.page_count
  el('page_title').textContent =
    '\u30DA\u30FC\u30B8 ' +
    (S3.page_index + 1) +
    '\uFF08' +
    (from + 1) +
    '\u301C' +
    to +
    '\u5C0F\u7BC0\uFF09'
}
function collect_measure_boxes(from, to) {
  let S3 = S
  S3.measure_boxes = []
  try {
    const gs = osmd.GraphicSheet || osmd.graphic
    const ml = gs.MeasureList || gs.measureList
    let zoom = osmd.zoom || 1
    let unit = 10 * zoom
    let off_x = 0,
      off_y = 0
    let wrap = el('sheet_wrap')
    const svg = qs('#sheet_host svg')
    if (wrap && svg) {
      let wr = wrap.getBoundingClientRect()
      let sr = svg.getBoundingClientRect()
      off_x = sr.left - wr.left
      off_y = sr.top - wr.top
    }
    for (let i3 = 0; i3 < ml.length; i3++) {
      let staff_measures = ml[i3]
      let m2 = staff_measures && staff_measures[0]
      if (!m2) continue
      let bb = m2.PositionAndShape
      let x = bb.AbsolutePosition.x * unit
      let w = bb.Size.width * unit
      let y = 0,
        h2 = 0
      let sys = m2.ParentMusicSystem || m2.parentMusicSystem
      if (sys && sys.PositionAndShape) {
        y = sys.PositionAndShape.AbsolutePosition.y * unit
        h2 = sys.PositionAndShape.Size.height * unit
      }
      S3.measure_boxes.push({
        measure: from + i3,
        x: x + off_x,
        w,
        y: Math.max(0, y + off_y - 8),
        h: Math.max(40, h2 + 20),
      })
    }
  } catch (e) {
    S3.measure_boxes = []
  }
}
function time_to_measure(t) {
  let Q = S.quantized
  if (!Q) return null
  let tick = ((t - Q.phase) / Q.quarter_sec) * DIV
  if (tick < 0) tick = 0
  let measure = Math.floor(tick / Q.measure_div)
  let frac = (tick - measure * Q.measure_div) / Q.measure_div
  return { measure, frac: clamp(frac, 0, 1) }
}
function update_playhead(t, follow) {
  let S3 = S
  let head = el('playhead')
  let pos = time_to_measure(t)
  if (!pos || pos.measure >= (S3.quantized ? S3.quantized.measure_count : 0)) {
    head.classList.add('is-hidden')
    return
  }
  let page = Math.floor(pos.measure / mpp)
  if (page !== S3.page_index) {
    if (follow) {
      S3.page_index = page
      render_page()
    }
    head.classList.add('is-hidden')
    return
  }
  let box = null
  for (let i3 = 0; i3 < S3.measure_boxes.length; i3++) {
    if (S3.measure_boxes[i3].measure === pos.measure) {
      box = S3.measure_boxes[i3]
      break
    }
  }
  if (!box) {
    head.classList.add('is-hidden')
    return
  }
  head.classList.remove('is-hidden')
  head.style.left = Math.round(box.x + box.w * pos.frac) + 'px'
  head.style.top = Math.round(box.y) + 'px'
  head.style.height = Math.round(box.h) + 'px'
  if (follow) {
    let frame = el('sheet_frame')
    let target = box.y - 40
    if (Math.abs(frame.scrollTop - target) > box.h) {
      frame.scrollTop = Math.max(0, target)
    }
  }
}
async function export_pdf(on_progress) {
  let S3 = S
  let Q = S3.quantized
  if (!Q) return
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast(
      'PDF\u30E9\u30A4\u30D6\u30E9\u30EA\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
    )
    return
  }
  if (!hidden_osmd) {
    hidden_osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(
      el('hidden_sheet'),
      {
        backend: 'svg',
        autoResize: false,
        drawTitle: false,
        drawSubtitle: false,
        drawComposer: false,
        drawPartNames: false,
        drawingParameters: 'compact',
      },
    )
  }
  let pdf = new window.jspdf.jsPDF({
    unit: 'pt',
    format: 'a4',
    orientation: 'portrait',
  })
  let page_w = pdf.internal.pageSize.getWidth()
  let page_h = pdf.internal.pageSize.getHeight()
  let margin = 36
  for (let page = 0; page < S3.page_count; page++) {
    if (on_progress)
      on_progress(
        page / S3.page_count,
        'PDF\u4F5C\u6210\u4E2D\u2026 ' + (page + 1) + '/' + S3.page_count,
      )
    let from = page * mpp
    let to = Math.min(Q.measure_count, from + mpp)
    let xml = build(Q, {
      from,
      to,
      layout: layout || void 0,
    })
    await hidden_osmd.load(xml)
    hidden_osmd.zoom = 1
    hidden_osmd.render()
    const svg = qs('#hidden_sheet svg')
    if (!svg) continue
    let svg_w =
      svg.width && svg.width.baseVal
        ? svg.width.baseVal.value
        : svg.clientWidth || 1200
    let svg_h =
      svg.height && svg.height.baseVal
        ? svg.height.baseVal.value
        : svg.clientHeight || 400
    let scale = Math.min(
      (page_w - margin * 2) / svg_w,
      (page_h - margin * 2) / svg_h,
    )
    if (page > 0) pdf.addPage()
    await pdf.svg(svg, {
      x: margin,
      y: margin,
      width: svg_w * scale,
      height: svg_h * scale,
    })
  }
  if (on_progress) on_progress(1, 'PDF\u4F5C\u6210\u5B8C\u4E86')
  return pdf.output('blob')
}

var alpha_override = null
var i2 = 0
var m = 0
function collect_onsets(notes) {
  let starts = notes
    .map(function (n) {
      return { t: n.start, w: n.amp }
    })
    .sort(function (a, b) {
      return a.t - b.t
    })
  const out = []
  for (let i3 = 0; i3 < starts.length; i3++) {
    let last = out[out.length - 1]
    if (last && starts[i3].t - last.t < 0.025) {
      last.w = Math.max(last.w, starts[i3].w)
    } else {
      out.push({ t: starts[i3].t, w: starts[i3].w })
    }
  }
  return out
}
function estimate_bpm(notes, duration) {
  let onsets = collect_onsets(notes)
  if (onsets.length < 5) return 120
  let bin = 0.01
  let len = Math.max(64, Math.ceil(Math.min(duration, 90) / bin))
  let train = new Float32Array(len)
  for (let i3 = 0; i3 < onsets.length; i3++) {
    let idx = Math.round(onsets[i3].t / bin)
    if (idx >= 0 && idx < len) train[idx] += 0.3 + onsets[i3].w
  }
  let lag_min = Math.round(0.24 / bin)
  let lag_max = Math.min(len - 1, Math.round(1.5 / bin))
  let PRIOR_CENTER = 0.5
  let PRIOR_SIGMA = 0.7
  let best_lag = 0,
    best_score = -Infinity
  for (let lag = lag_min; lag <= lag_max; lag++) {
    let score = 0
    for (let t = 0; t + lag < len; t++) {
      score += train[t] * train[t + lag]
    }
    let lag2 = lag * 2
    if (lag2 < len) {
      let s2 = 0
      for (let t2 = 0; t2 + lag2 < len; t2 += 2)
        s2 += train[t2] * train[t2 + lag2]
      score += s2 * 0.4
    }
    let lg = Math.log((lag * bin) / PRIOR_CENTER)
    score *= Math.exp(-(lg * lg) / (2 * PRIOR_SIGMA * PRIOR_SIGMA))
    if (score > best_score) {
      best_score = score
      best_lag = lag
    }
  }
  if (!best_lag) return 120
  let bpm = 60 / (best_lag * bin)
  while (bpm < 70) bpm *= 2
  while (bpm > 185) bpm /= 2
  return Math.round(bpm)
}
function fit_phase(notes, bpm) {
  let onsets = collect_onsets(notes)
  if (!onsets.length) return 0
  let beat = 60 / bpm
  let sin_sum = 0,
    cos_sum = 0
  for (let i3 = 0; i3 < onsets.length; i3++) {
    let theta = ((onsets[i3].t % beat) / beat) * Math.PI * 2
    let w = 0.3 + onsets[i3].w
    sin_sum += Math.sin(theta) * w
    cos_sum += Math.cos(theta) * w
  }
  let mean_theta = Math.atan2(sin_sum, cos_sum)
  if (mean_theta < 0) mean_theta += Math.PI * 2
  let phase = (mean_theta / (Math.PI * 2)) * beat
  let first = onsets[0].t
  while (phase > first + beat * 0.5) phase -= beat
  if (phase < 0) phase = ((phase % beat) + beat) % beat
  return phase
}
function track_beats(notes, duration, bpm_hint) {
  let onsets = collect_onsets(notes)
  let tau0 = 60 / (bpm_hint || 120)
  if (onsets.length < 4 || duration < tau0 * 2) {
    return beats_from_bpm(bpm_hint || 120, 0, duration)
  }
  let bin = 0.01
  let len = Math.ceil(duration / bin) + 1
  let env = new Float32Array(len)
  for (let i3 = 0; i3 < onsets.length; i3++) {
    let c = onsets[i3].t / bin
    let w = 0.3 + onsets[i3].w
    for (let d = -3; d <= 3; d++) {
      let idx = Math.round(c + d)
      if (idx >= 0 && idx < len) env[idx] += w * Math.exp(-(d * d) / 4)
    }
  }
  let emax = 0
  for (i2 = 0; i2 < len; i2++) if (env[i2] > emax) emax = env[i2]
  if (emax > 0) for (i2 = 0; i2 < len; i2++) env[i2] /= emax
  let ALPHA = alpha_override != null ? alpha_override : 5
  let lo = Math.max(1, Math.round((tau0 * 0.45) / bin))
  let hi = Math.round((tau0 * 1.9) / bin)
  let C = new Float32Array(len).fill(-1e9)
  let bp = new Int32Array(len).fill(-1)
  for (i2 = 0; i2 < len; i2++) {
    let base = env[i2]
    if (i2 < lo) {
      C[i2] = base
      continue
    }
    let best = base
    let bj = -1
    let j0 = Math.max(0, i2 - hi)
    for (let j = i2 - lo; j >= j0; j--) {
      if (C[j] <= -1e8) continue
      let r = Math.log(((i2 - j) * bin) / tau0)
      let v = C[j] - ALPHA * r * r + base
      if (v > best) {
        best = v
        bj = j
      }
    }
    C[i2] = best
    bp[i2] = bj
  }
  let end0 = Math.max(0, len - Math.round((tau0 * 1.2) / bin))
  let bi = end0
  for (i2 = end0; i2 < len; i2++) if (C[i2] > C[bi]) bi = i2
  let beats = []
  while (bi >= 0) {
    beats.push(bi * bin)
    bi = bp[bi]
  }
  beats.reverse()
  if (beats.length < 2) return beats_from_bpm(bpm_hint || 120, 0, duration)
  let refined = beats.map(function (b) {
    let c0 = Math.max(0, Math.round((b - 0.06) / bin))
    let c1 = Math.min(len - 1, Math.round((b + 0.06) / bin))
    let wsum = 0,
      tsum = 0
    for (let k = c0; k <= c1; k++) {
      wsum += env[k]
      tsum += env[k] * k * bin
    }
    return wsum > 0.05 ? tsum / wsum : b
  })
  for (let m2 = 1; m2 < refined.length; m2++) {
    if (refined[m2] <= refined[m2 - 1] + 0.05)
      refined[m2] = refined[m2 - 1] + 0.05
  }
  let ib = []
  for (m = 1; m < refined.length; m++) ib.push(refined[m] - refined[m - 1])
  let sm = ib.slice()
  for (m = 1; m < ib.length - 1; m++) {
    let tri = [ib[m - 1], ib[m], ib[m + 1]].sort(function (a2, b2) {
      return a2 - b2
    })
    sm[m] = (ib[m] + tri[1]) / 2
  }
  beats = [refined[0]]
  for (m = 0; m < sm.length; m++) beats.push(beats[beats.length - 1] + sm[m])
  let first_ibi = beats[1] - beats[0]
  while (beats[0] - first_ibi > -first_ibi * 0.5)
    beats.unshift(beats[0] - first_ibi)
  let last_ibi = beats[beats.length - 1] - beats[beats.length - 2]
  while (beats[beats.length - 1] + last_ibi < duration + last_ibi * 0.5) {
    beats.push(beats[beats.length - 1] + last_ibi)
  }
  return beats
}
function beats_from_bpm(bpm, phase, duration) {
  let q = 60 / (bpm || 120)
  let beats = []
  let t = phase || 0
  while (t > 0) t -= q
  for (; t < duration + q; t += q) beats.push(t)
  return beats
}

var on2 = on
var S2 = S
var cache = {
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
  return !!S2.quantized && !!cache.passes
}
var wake_lock = null
async function acquire_wake_lock() {
  try {
    if (navigator.wakeLock && is_visible()) {
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
var keepalive_ctx = null
var keepalive_osc = null
function start_keepalive() {
  if (keepalive_ctx) return
  try {
    let AC = window.AudioContext || window.webkitAudioContext
    keepalive_ctx = new AC()
    keepalive_osc = keepalive_ctx.createOscillator()
    let g = keepalive_ctx.createGain()
    keepalive_osc.frequency.value = 30
    g.gain.value = 1e-4
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
var busy_lock_release = null
function acquire_busy_lock() {
  if (!(navigator.locks && navigator.locks.request) || busy_lock_release) return
  try {
    navigator.locks
      .request('minamoscore-transcribing', function () {
        return new Promise(function (resolve) {
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
var base_title = 'Minamo Score'
function set_title_progress(ratio) {
  set_title(
    ratio == null ? null : Math.round(ratio * 100) + '% \u89E3\u6790\u4E2D',
    base_title,
  )
}
on_visibility(function () {
  if (is_visible() && S2.busy && !wake_lock) acquire_wake_lock()
})
function format_size(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function set_source(blob, name) {
  if (!blob) return
  if (S2.source_url) {
    try {
      URL.revokeObjectURL(S2.source_url)
    } catch (e) {}
  }
  S2.source_file = blob
  S2.source_name = name || 'audio'
  S2.source_url = URL.createObjectURL(blob)
  cache.base_name = (S2.source_name.replace(/\.[^.]+$/, '') || 'minamo').slice(
    0,
    60,
  )
  el('source_name').textContent = S2.source_name
  el('source_meta').textContent =
    (format_size(blob.size) ? format_size(blob.size) + '\u30FB' : '') +
    '\u300C\u5909\u63DB\u3059\u308B\u300D\u3067\u63A1\u8B5C\u3057\u307E\u3059'
  let prev = el('source_preview')
  prev.src = S2.source_url
  prev.classList.remove('is-hidden')
  el('source_badge').textContent = '\u9078\u629E\u6E08\u307F'
  set_status('\u97F3\u58F0\u3092\u9078\u629E\u6E08\u307F')
  if (has_result()) {
    set_global_status(
      '\u97F3\u58F0\u3092\u5DEE\u3057\u66FF\u3048\u307E\u3057\u305F\u3002\u300C\u5909\u63DB\u3059\u308B\u300D\u3067\u63A1\u8B5C\u3057\u76F4\u305B\u307E\u3059\u3002',
    )
  }
}
on2(el('file_input'), 'change', function (e) {
  const inp = e.target
  const f = inp.files && inp.files[0]
  if (f) set_source(f, f.name)
  inp.value = ''
})
var dz = el('drop_zone')
on2(dz, 'dragover', function (e) {
  e.preventDefault()
  dz.classList.add('is-over')
})
on2(dz, 'dragleave', function () {
  dz.classList.remove('is-over')
})
on2(dz, 'drop', function (e) {
  e.preventDefault()
  dz.classList.remove('is-over')
  const dt = e.dataTransfer
  const f = dt && dt.files && dt.files[0]
  if (f) set_source(f, f.name)
})
on2(el('btn_clear_source'), 'click', function () {
  if (S2.source_url) {
    try {
      URL.revokeObjectURL(S2.source_url)
    } catch (e) {}
  }
  S2.source_file = null
  S2.source_name = ''
  S2.source_url = ''
  el('source_name').textContent =
    '\u97F3\u58F0\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093'
  el('source_meta').textContent =
    '\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u3076\u304B\u9332\u97F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002'
  let prev = el('source_preview')
  prev.removeAttribute('src')
  prev.classList.add('is-hidden')
  el('source_badge').textContent = '\u672A\u9078\u629E'
  set_status('\u5F85\u6A5F\u4E2D')
})
on2(el('btn_record'), 'click', async function () {
  try {
    await start_record()
    el('btn_record').disabled = true
    el('btn_stop_record').disabled = false
    el('btn_use_recording').disabled = true
    let st = el('record_status')
    st.textContent = '\u9332\u97F3\u4E2D\u2026'
    st.classList.add('is-live')
  } catch (e) {
    toast(
      '\u30DE\u30A4\u30AF\u3092\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F',
    )
  }
})
on2(el('btn_stop_record'), 'click', function () {
  stop_record()
  el('btn_stop_record').disabled = true
})
set_on_record_done(function (blob) {
  el('btn_record').disabled = false
  el('btn_stop_record').disabled = true
  el('btn_use_recording').disabled = false
  let st = el('record_status')
  st.textContent =
    '\u9332\u97F3\u6E08\u307F\uFF08' + format_size(blob.size) + '\uFF09'
  st.classList.remove('is-live')
  let prev = el('record_preview')
  prev.src = URL.createObjectURL(blob)
  prev.classList.remove('is-hidden')
})
on2(el('btn_use_recording'), 'click', function () {
  if (!S2.record_blob) return
  let d = new Date()
  function pad(v) {
    return (v < 10 ? '0' : '') + v
  }
  let stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes())
  let ext = (S2.record_blob.type || '').indexOf('mp4') >= 0 ? '.m4a' : '.webm'
  set_source(S2.record_blob, '\u9332\u97F3_' + stamp + ext)
})
function build_notes() {
  let preset = presets[cache.profile] || presets.piano
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
  let built = build2(
    cache.passes.precision,
    cache.passes.recall,
    preset,
    select('sel_split_mode').value,
    parseInt(input('in_split').value, 10),
  )
  S2.raw_notes = built.notes
  cache.split = built.split
  cache.added = built.added_by_recall
  if (select('sel_split_mode').value === 'auto')
    input('in_split').value = String(built.split)
  cache.detected_bpm = estimate_bpm(S2.raw_notes, S2.duration)
  if (select('sel_bpm_mode').value === 'auto')
    input('in_bpm').value = String(cache.detected_bpm)
}
function resolve_bpm() {
  if (select('sel_bpm_mode').value === 'manual') {
    return clamp(parseInt(input('in_bpm').value, 10) || 120, 40, 240)
  }
  return cache.detected_bpm
}
function requantize() {
  if (!cache.passes) return
  let bpm = resolve_bpm()
  let phase = fit_phase(S2.raw_notes, bpm)
  let beats = null
  if (select('sel_bpm_mode').value === 'auto') {
    beats = track_beats(S2.raw_notes, S2.duration || 0, bpm)
  }
  S2.quantized = run(S2.raw_notes, {
    beats,
    bpm,
    phase,
    grid: select('sel_grid').value,
    ts_num: clamp(parseInt(input('in_ts_num').value, 10) || 4, 1, 12),
    ts_den: parseInt(select('sel_ts_den').value, 10) || 4,
    density: select('sel_density').value,
    split: cache.split,
  })
  let keep_zoom = S2.zoom
  let keep_page = S2.page_index
  setup(S2.quantized, parseInt(select('sel_mpp').value, 10) || 4)
  if (keep_zoom) S2.zoom = keep_zoom
  S2.page_index = clamp(keep_page, 0, S2.page_count - 1)
  update_summary()
}
function refresh_all() {
  build_notes()
  requantize()
  set_range(S2.raw_notes)
  resize()
  render_page()
}
function update_summary() {
  let Q = S2.quantized
  if (!Q) return
  el('sum_duration').textContent = fmt_time(S2.duration)
  el('sum_notes').textContent =
    S2.raw_notes.length +
    (cache.added ? '\uFF08+' + cache.added + ' \u611F\u5EA6\uFF09' : '')
  el('sum_bpm').textContent =
    Q.bpm +
    (select('sel_bpm_mode').value === 'auto' ? '\u30FB\u81EA\u52D5' : '')
  if (S2.raw_notes.length) {
    let lo = 127,
      hi = 0
    for (let i3 = 0; i3 < S2.raw_notes.length; i3++) {
      if (S2.raw_notes[i3].pitch < lo) lo = S2.raw_notes[i3].pitch
      if (S2.raw_notes[i3].pitch > hi) hi = S2.raw_notes[i3].pitch
    }
    el('sum_range').textContent = midi_name(lo) + '\u301C' + midi_name(hi)
  } else {
    el('sum_range').textContent = '\u2013'
  }
  el('sum_grid').textContent = Q.step_label
  el('sum_pages').textContent =
    S2.page_count + '\u30DA\u30FC\u30B8 / ' + Q.measure_count + '\u5C0F\u7BC0'
}
function mark_stale() {
  if (has_result()) {
    set_global_status(
      '\u3053\u306E\u8A2D\u5B9A\u306F\u300C\u5909\u63DB\u3059\u308B\u300D\u3092\u62BC\u3059\u3068\u53CD\u6620\u3055\u308C\u307E\u3059\uFF08\u89E3\u6790\u304B\u3089\u3084\u308A\u76F4\u3057\u307E\u3059\uFF09\u3002',
    )
  }
}
on2(el('sel_profile'), 'change', mark_stale)
on2(el('sel_quality'), 'change', mark_stale)
on2(el('chk_vocal_cut'), 'change', mark_stale)
function fast_reflect() {
  if (!has_result()) return
  requantize()
  render_page()
}
on2(el('sel_density'), 'change', fast_reflect)
on2(el('sel_grid'), 'change', fast_reflect)
on2(el('in_ts_num'), 'change', fast_reflect)
on2(el('sel_ts_den'), 'change', fast_reflect)
on2(el('sel_mpp'), 'change', fast_reflect)
on2(el('sel_bpm_mode'), 'change', function () {
  el('in_bpm').disabled = select('sel_bpm_mode').value !== 'manual'
  fast_reflect()
})
on2(el('in_bpm'), 'change', fast_reflect)
function rebuild_reflect() {
  if (!has_result()) return
  build_notes()
  requantize()
  set_range(S2.raw_notes)
  draw()
  render_page()
}
on2(el('sel_split_mode'), 'change', function () {
  el('in_split').disabled = select('sel_split_mode').value !== 'manual'
  rebuild_reflect()
})
on2(el('in_split'), 'change', rebuild_reflect)
function settings_snapshot() {
  return {
    profile: select('sel_profile').value,
    quality: select('sel_quality').value,
    vocal_cut: input('chk_vocal_cut').checked,
    bpm_mode: select('sel_bpm_mode').value,
    bpm_value: parseInt(input('in_bpm').value, 10) || 120,
    split_mode: select('sel_split_mode').value,
    split_value: parseInt(input('in_split').value, 10) || 60,
    grid: select('sel_grid').value,
    density: select('sel_density').value,
    ts_num: parseInt(input('in_ts_num').value, 10) || 4,
    ts_den: parseInt(select('sel_ts_den').value, 10) || 4,
    mpp: parseInt(select('sel_mpp').value, 10) || 4,
  }
}
function apply_settings(st) {
  if (!st) return
  select('sel_profile').value = String(st.profile || 'piano')
  select('sel_quality').value = String(st.quality || 'high')
  input('chk_vocal_cut').checked = !!st.vocal_cut
  select('sel_bpm_mode').value = String(st.bpm_mode || 'auto')
  input('in_bpm').value = String(st.bpm_value || 120)
  select('sel_split_mode').value = String(st.split_mode || 'auto')
  input('in_split').value = String(st.split_value || 60)
  select('sel_grid').value = String(st.grid || 'auto')
  select('sel_density').value = String(st.density || 'preserve')
  input('in_ts_num').value = String(st.ts_num || 4)
  select('sel_ts_den').value = String(st.ts_den || 4)
  select('sel_mpp').value = String(st.mpp || 4)
  el('in_bpm').disabled = select('sel_bpm_mode').value !== 'manual'
  el('in_split').disabled = select('sel_split_mode').value !== 'manual'
}
function save_history() {
  if (!cache.passes || !S2.raw_notes.length) return
  let record = {
    id: Date.now(),
    name: S2.source_name || cache.base_name,
    created: new Date().toISOString(),
    duration: S2.duration,
    backend: cache.backend,
    engine: cache.engine,
    quality: cache.quality,
    notes_count: S2.raw_notes.length,
    passes: { precision: cache.passes.precision, recall: cache.passes.recall },
    settings: settings_snapshot(),
  }
  save(record, S2.source_file || null)
    .then(render_history)
    .catch(function () {})
}
function fmt_history_date(iso) {
  let d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  function pad(v) {
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
function reconvert_history(id) {
  if (S2.busy) {
    toast(
      '\u51E6\u7406\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304F\u3060\u3055\u3044',
    )
    return
  }
  get(id)
    .then(function (got) {
      if (!got.record || !got.audio || !got.audio.blob) {
        toast(
          '\u97F3\u58F0\u304C\u4FDD\u5B58\u3055\u308C\u3066\u3044\u306A\u3044\u305F\u3081\u518D\u5909\u63DB\u3067\u304D\u307E\u305B\u3093',
        )
        return
      }
      let f = new File([got.audio.blob], got.record.name || 'audio', {
        type: got.audio.type || got.audio.blob.type || 'audio/mpeg',
      })
      S2.source_file = f
      S2.source_name = f.name
      el('source_name').textContent =
        f.name + '\uFF08\u5C65\u6B74\u306E\u97F3\u58F0\uFF09'
      convert()
    })
    .catch(function () {
      toast(
        '\u5C65\u6B74\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
      )
    })
}
function render_history() {
  let ul = el('history_list')
  list()
    .then(function (items) {
      ul.textContent = ''
      if (!items.length) {
        const li0 = h('li', 'history-empty')
        li0.textContent =
          '\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002\u5909\u63DB\u304C\u7D42\u308F\u308B\u3068\u81EA\u52D5\u3067\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002'
        ul.appendChild(li0)
        return
      }
      items.forEach(function (it) {
        const li = h('li', 'history-item')
        const info = h('div', 'history-info')
        const name = h('p', 'history-name')
        name.textContent = it.name || '\u7121\u984C'
        const meta = h('p', 'history-meta')
        meta.textContent =
          fmt_history_date(it.created) +
          '\u30FB' +
          fmt_time(it.duration || 0) +
          '\u30FB' +
          (it.notes_count || 0) +
          '\u97F3' +
          (it.has_audio ? '' : '\u30FB\u97F3\u58F0\u306A\u3057')
        info.appendChild(name)
        info.appendChild(meta)
        const btns = h('div', 'history-btns')
        const open_b = hbutton('btn btn-small', '\u958B\u304F')
        on(open_b, 'click', function () {
          load_history(it.id)
        })
        const del_b = hbutton('btn btn-small btn-danger', '\u524A\u9664')
        on(del_b, 'click', function () {
          remove(it.id)
            .then(render_history)
            .catch(function () {
              toast('\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F')
            })
        })
        if (it.has_audio) {
          const re_b = hbutton('btn btn-small', '\u518D\u5909\u63DB')
          re_b.title =
            '\u4FDD\u5B58\u3055\u308C\u305F\u97F3\u58F0\u3092\u73FE\u884C\u30A8\u30F3\u30B8\u30F3\u3067\u5909\u63DB\u3057\u76F4\u3059'
          on(re_b, 'click', function () {
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
function load_history(id) {
  if (S2.busy) {
    toast(
      '\u51E6\u7406\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304F\u3060\u3055\u3044',
    )
    return
  }
  get(id)
    .then(function (res) {
      let rec = res.record
      if (!rec || !rec.passes) {
        toast(
          '\u3053\u306E\u5C65\u6B74\u306F\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F',
        )
        return
      }
      stop()
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
      S2.duration = rec.duration || 0
      S2.play_pos = 0
      if (res.audio && res.audio.blob) {
        set_source(res.audio.blob, rec.name)
      } else {
        cache.base_name = (
          (rec.name || 'minamo').replace(/\.[^.]+$/, '') || 'minamo'
        ).slice(0, 60)
        el('source_name').textContent =
          (rec.name || '\u7121\u984C') +
          '\uFF08\u97F3\u58F0\u306F\u672A\u4FDD\u5B58\u30FB\u518D\u89E3\u6790\u306F\u4E0D\u53EF\uFF09'
      }
      refresh_all()
      el('empty_state').classList.add('is-hidden')
      el('result_section').classList.remove('is-hidden')
      update_transport()
      preload(S2.raw_notes)
      set_global_status(
        '\u5C65\u6B74\u304B\u3089\u5FA9\u5143\u3057\u307E\u3057\u305F\uFF1A' +
          (rec.name || '\u7121\u984C'),
        'ok',
      )
      set_status('\u5909\u63DB\u6E08\u307F')
    })
    .catch(function () {
      toast(
        '\u5C65\u6B74\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F',
      )
    })
}
async function convert() {
  if (S2.busy) {
    toast(
      '\u51E6\u7406\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304F\u3060\u3055\u3044',
    )
    return
  }
  if (!S2.source_file) {
    toast(
      '\u5148\u306B\u97F3\u58F0\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044',
    )
    return
  }
  S2.busy = true
  el('btn_convert').disabled = true
  acquire_wake_lock()
  acquire_busy_lock()
  start_keepalive()
  stop()
  stop_frame_loop()
  set_status('\u5909\u63DB\u4E2D\u2026')
  set_global_status(
    '\u97F3\u58F0\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u3059\u2026',
  )
  set_progress(0.02, '\u97F3\u58F0\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026')
  try {
    let vc = input('chk_vocal_cut').checked
    let profile = select('sel_profile').value
    let quality = select('sel_quality').value
    let plan2 = plan(profile, quality)
    if (vc && plan2.engine === 'hires') {
      vc = false
      toast(
        '\u30D4\u30A2\u30CE\u7279\u5316AI\u3067\u306F\u30DC\u30FC\u30AB\u30EB\u30AB\u30C3\u30C8\u3092\u7121\u52B9\u306B\u3057\u307E\u3057\u305F',
      )
    }
    let preset = presets[profile] || presets.piano
    let decoded
    try {
      decoded = await decode(S2.source_file, vc, plan2.rate)
    } catch (e0) {
      throw new Error(
        '\u3053\u306E\u97F3\u58F0\u306F\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\uFF08\u5F62\u5F0F\u975E\u5BFE\u5FDC\u306E\u53EF\u80FD\u6027\uFF09',
      )
    }
    S2.duration = decoded.duration
    set_progress(
      0.04,
      '\u63A1\u8B5C\u30E2\u30C7\u30EB\u3092\u6E96\u5099\u4E2D\u2026',
    )
    let passes = await transcribe(
      decoded.samples,
      preset,
      plan2,
      quality,
      function (ratio, text) {
        let p = 0.04 + clamp(ratio, 0, 1) * 0.84
        set_progress(p, text)
        set_title_progress(p)
        if (text) set_global_status(text)
      },
    )
    cache.passes = passes
    cache.profile = profile
    cache.vocal_cut = vc
    cache.quality = passes.quality || quality
    cache.engine = passes.engine || plan2.engine
    cache.backend = passes.backend || ''
    set_progress(
      0.92,
      '\u697D\u8B5C\u3092\u7D44\u3093\u3067\u3044\u307E\u3059\u2026',
    )
    set_global_status(
      '\u697D\u8B5C\u3092\u7D44\u3093\u3067\u3044\u307E\u3059\u2026',
    )
    S2.play_pos = 0
    refresh_all()
    el('empty_state').classList.add('is-hidden')
    el('result_section').classList.remove('is-hidden')
    update_transport()
    if (!S2.raw_notes.length) {
      set_progress(1, '\u5B8C\u4E86\uFF08\u97F3\u7B26\u306A\u3057\uFF09')
      set_global_status(
        '\u97F3\u3092\u691C\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u97F3\u91CF\u3084\u300C\u97F3\u6E90\u306E\u7A2E\u985E\u300D\u300C\u4ED5\u4E0A\u304C\u308A\u300D\u3092\u898B\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
        'error',
      )
    } else {
      set_progress(1, '\u5B8C\u4E86')
      const ghosts = (cache.passes && cache.passes.ghosts_removed) || 0
      let ghost_note =
        ghosts > 0
          ? ' \uFF0F \u500D\u97F3\u30B4\u30FC\u30B9\u30C8' +
            ghosts +
            '\u500B\u9664\u53BB'
          : ''
      const Q = S2.quantized
      set_global_status(
        '\u5909\u63DB\u5B8C\u4E86\uFF1A\u97F3\u7B26 ' +
          S2.raw_notes.length +
          '\u500B / ' +
          Q.measure_count +
          '\u5C0F\u7BC0 / \u30C6\u30F3\u30DD ' +
          Q.bpm +
          '\uFF08' +
          Q.step_label +
          '\uFF09' +
          (cache.engine === 'hires'
            ? ' \uFF0F \u9AD8\u7CBE\u5EA6\u30D4\u30A2\u30CEAI'
            : ' \uFF0F \u6A19\u6E96\u30A8\u30F3\u30B8\u30F3') +
          (cache.backend
            ? '\uFF08' + cache.backend.toUpperCase() + '\uFF09'
            : '') +
          ghost_note,
        'ok',
      )
      toast('\u5909\u63DB\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F')
      save_history()
      preload(S2.raw_notes)
    }
  } catch (err) {
    set_progress(0, '\u5931\u6557')
    set_global_status(
      '\u5909\u63DB\u306B\u5931\u6557: ' + err_text(err),
      'error',
    )
    toast('\u5909\u63DB\u306B\u5931\u6557\u3057\u307E\u3057\u305F')
  } finally {
    S2.busy = false
    release_wake_lock()
    release_busy_lock()
    stop_keepalive()
    set_title_progress(null)
    el('btn_convert').disabled = false
    set_status(has_result() ? '\u5909\u63DB\u6E08\u307F' : '\u5F85\u6A5F\u4E2D')
  }
}
on2(el('btn_convert'), 'click', convert)
on2(el('btn_prev_page'), 'click', function () {
  if (!has_result() || S2.page_index <= 0) return
  S2.page_index--
  render_page()
})
on2(el('btn_next_page'), 'click', function () {
  if (!has_result() || S2.page_index >= S2.page_count - 1) return
  S2.page_index++
  render_page()
})
on2(el('btn_zoom_in'), 'click', function () {
  if (!has_result()) return
  S2.zoom = clamp(S2.zoom * 1.15, 0.5, 2)
  render_page()
})
on2(el('btn_zoom_out'), 'click', function () {
  if (!has_result()) return
  S2.zoom = clamp(S2.zoom / 1.15, 0.5, 2)
  render_page()
})
on2(el('btn_zoom_fit'), 'click', function () {
  if (!has_result()) return
  S2.zoom = default_zoom()
  render_page()
})
var resize_timer = 0
on2(window, 'resize', function () {
  clearTimeout(resize_timer)
  resize_timer = setTimeout(function () {
    if (has_result()) render_page()
  }, 260)
})
var raf = 0
function update_transport() {
  let pos = S2.playing ? position() : S2.play_pos
  pos = clamp(pos, 0, S2.duration || 0)
  el('transport_time').textContent =
    fmt_time(pos) + ' / ' + fmt_time(S2.duration || 0)
  if (!S2.playing && has_result()) {
    update_playhead(pos, false)
  }
}
function frame_loop() {
  update_transport()
  draw()
  if (S2.playing) {
    update_playhead(position(), input('chk_follow').checked)
    raf = requestAnimationFrame(frame_loop)
  }
}
function stop_frame_loop() {
  cancelAnimationFrame(raf)
  raf = 0
}
var loading_samples = false
on2(el('btn_play'), 'click', async function () {
  if (!has_result()) {
    toast('\u5148\u306B\u5909\u63DB\u3057\u3066\u304F\u3060\u3055\u3044')
    return
  }
  if (!S2.raw_notes.length) {
    toast(
      '\u518D\u751F\u3067\u304D\u308B\u97F3\u7B26\u304C\u3042\u308A\u307E\u305B\u3093',
    )
    return
  }
  if (S2.playing || loading_samples) return
  loading_samples = true
  try {
    await preload(S2.raw_notes, function (done, total) {
      set_status(
        '\u30D4\u30A2\u30CE\u97F3\u6E90\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026 ' +
          done +
          '/' +
          total,
      )
    })
  } catch (e) {}
  loading_samples = false
  set_status('\u5909\u63DB\u6E08\u307F')
  play()
  stop_frame_loop()
  frame_loop()
})
on2(el('btn_pause'), 'click', function () {
  if (!S2.playing) return
  pause()
  stop_frame_loop()
  update_transport()
  draw()
})
on2(el('btn_stop'), 'click', function () {
  stop()
  stop_frame_loop()
  el('playhead').classList.add('is-hidden')
  update_transport()
  draw()
  if (has_result() && S2.page_index !== 0) {
    S2.page_index = 0
    render_page()
  }
})
set_on_end(function () {
  stop_frame_loop()
  el('playhead').classList.add('is-hidden')
  update_transport()
  draw()
})
function need_result() {
  if (!has_result()) {
    toast('\u5148\u306B\u5909\u63DB\u3057\u3066\u304F\u3060\u3055\u3044')
    return false
  }
  return true
}
on2(el('btn_dl_xml'), 'click', function () {
  if (!need_result()) return
  let xml = build(S2.quantized)
  download_blob(
    new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }),
    cache.base_name + '.musicxml',
  )
  toast('MusicXML\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F')
})
on2(el('btn_dl_midi'), 'click', function () {
  if (!need_result()) return
  download_blob(
    build_quantized(S2.quantized),
    cache.base_name + '_\u697D\u8B5C\u3069\u304A\u308A.mid',
  )
  toast(
    'MIDI\uFF08\u697D\u8B5C\u3069\u304A\u308A\uFF09\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F',
  )
})
on2(el('btn_dl_midi_raw'), 'click', function () {
  if (!need_result()) return
  download_blob(
    build_raw(S2.raw_notes, S2.quantized.bpm),
    cache.base_name + '_\u6F14\u594F\u3069\u304A\u308A.mid',
  )
  toast(
    'MIDI\uFF08\u6F14\u594F\u3069\u304A\u308A\uFF09\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F',
  )
})
on2(el('btn_dl_pdf'), 'click', async function () {
  if (!need_result()) return
  if (S2.busy) {
    toast(
      '\u51E6\u7406\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304F\u3060\u3055\u3044',
    )
    return
  }
  S2.busy = true
  try {
    let blob = await export_pdf(function (ratio, text) {
      set_progress(ratio, text)
    })
    if (blob) {
      download_blob(blob, cache.base_name + '.pdf')
      toast('PDF\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F')
    }
  } catch (e) {
    toast('PDF\u306E\u4F5C\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F')
    set_global_status('PDF\u5931\u6557: ' + err_text(e), 'error')
  } finally {
    S2.busy = false
  }
})
on2(window, 'keydown', function (e) {
  const tgt = e.target
  const tag = tgt ? tgt.tagName : ''
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === ' ') {
    e.preventDefault()
    if (S2.playing) el('btn_pause').click()
    else el('btn_play').click()
  } else if (e.key === 'ArrowLeft') {
    el('btn_prev_page').click()
  } else if (e.key === 'ArrowRight') {
    el('btn_next_page').click()
  }
})
init()
render_history()
el('in_bpm').disabled = select('sel_bpm_mode').value !== 'manual'
el('in_split').disabled = select('sel_split_mode').value !== 'manual'
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {})
  if (!window.crossOriginIsolated) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (S2.busy) return
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
