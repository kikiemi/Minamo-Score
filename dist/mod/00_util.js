const ui_cache = {}
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
function qsa(sel) {
  return Array.prototype.slice.call(document.querySelectorAll(sel))
}
function on(target, ev, fn, opt) {
  target.addEventListener(ev, fn, opt)
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
let toast_timer = 0
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
let progress_text_memo = ''
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
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m + ':' + (r < 10 ? '0' : '') + r
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
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
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
function button(id) {
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
export {
  button,
  clamp,
  download_blob,
  el,
  err_text,
  fmt_time,
  h,
  hbutton,
  input,
  is_visible,
  median,
  midi_name,
  on,
  on_visibility,
  percentile,
  qs,
  qsa,
  select,
  set_global_status,
  set_progress,
  set_status,
  set_title,
  toast,
}
