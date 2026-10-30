const ui_cache: Record<string, HTMLElement> = {}

export interface UiMap {
  btn_clear_source: HTMLButtonElement
  btn_convert: HTMLButtonElement
  btn_dl_midi: HTMLButtonElement
  btn_dl_midi_raw: HTMLButtonElement
  btn_dl_pdf: HTMLButtonElement
  btn_dl_xml: HTMLButtonElement
  btn_next_page: HTMLButtonElement
  btn_pause: HTMLButtonElement
  btn_play: HTMLButtonElement
  btn_prev_page: HTMLButtonElement
  btn_record: HTMLButtonElement
  btn_stop: HTMLButtonElement
  btn_stop_record: HTMLButtonElement
  btn_use_recording: HTMLButtonElement
  btn_zoom_fit: HTMLButtonElement
  btn_zoom_in: HTMLButtonElement
  btn_zoom_out: HTMLButtonElement
  chk_follow: HTMLInputElement
  chk_vocal_cut: HTMLInputElement
  drop_zone: HTMLElement
  empty_state: HTMLElement
  file_input: HTMLInputElement
  global_status: HTMLElement
  hidden_sheet: HTMLElement
  history_list: HTMLElement
  in_bpm: HTMLInputElement
  in_split: HTMLInputElement
  in_ts_num: HTMLInputElement
  page_indicator: HTMLElement
  page_title: HTMLElement
  playhead: HTMLElement
  progress_bar: HTMLElement
  progress_text: HTMLElement
  record_preview: HTMLAudioElement
  record_status: HTMLElement
  result_section: HTMLElement
  roll_canvas: HTMLCanvasElement
  sel_bpm_mode: HTMLSelectElement
  sel_density: HTMLSelectElement
  sel_grid: HTMLSelectElement
  sel_mpp: HTMLSelectElement
  sel_profile: HTMLSelectElement
  sel_quality: HTMLSelectElement
  sel_split_mode: HTMLSelectElement
  sel_ts_den: HTMLSelectElement
  sheet_frame: HTMLElement
  sheet_host: HTMLElement
  sheet_wrap: HTMLElement
  source_badge: HTMLElement
  source_meta: HTMLElement
  source_name: HTMLElement
  source_preview: HTMLAudioElement
  status_pill: HTMLElement
  sum_bpm: HTMLElement
  sum_duration: HTMLElement
  sum_grid: HTMLElement
  sum_notes: HTMLElement
  sum_pages: HTMLElement
  sum_range: HTMLElement
  toast: HTMLElement
  transport_time: HTMLElement
}

export function el<K extends keyof UiMap>(id: K): UiMap[K] {
  let hit = ui_cache[id as string]
  if (!hit) {
    const found = document.getElementById(id as string)
    if (!found) {
      throw new Error('ui element missing: ' + (id as string))
    }
    hit = found
    ui_cache[id as string] = hit
  }
  return hit as UiMap[K]
}

export function qs(sel: string): HTMLElement | null {
  return document.querySelector(sel)
}

export function qsa(sel: string): HTMLElement[] {
  return Array.prototype.slice.call(document.querySelectorAll(sel))
}

export function on(
  target: EventTarget,
  ev: string,
  fn: (e: Event) => void,
  opt?: AddEventListenerOptions,
): void {
  target.addEventListener(ev, fn, opt)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

let toast_timer = 0
export function toast(msg: string): void {
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

export function set_status(msg: string): void {
  el('status_pill').textContent = msg
}

export function set_global_status(msg: string, tone?: string): void {
  const box = el('global_status')
  box.textContent = msg
  box.className = 'global-status' + (tone ? ' is-' + tone : '')
}

let progress_text_memo = ''
export function set_progress(ratio: number, text?: string | null): void {
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

export function fmt_time(sec: number): string {
  let s = sec
  if (!isFinite(s) || s < 0) {
    s = 0
  }
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m + ':' + (r < 10 ? '0' : '') + r
}

export function download_blob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(function () {
    URL.revokeObjectURL(a.href)
  }, 4000)
}

export function median(arr: number[]): number {
  if (!arr.length) {
    return 0
  }
  const s = arr.slice().sort(function (a, b) {
    return a - b
  })
  return s[s.length >> 1]
}

export function percentile(arr: number[], p: number): number {
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
export function midi_name(midi: number): string {
  const p = Math.round(midi)
  return NAMES[((p % 12) + 12) % 12] + String(Math.floor(p / 12) - 1)
}

export function err_text(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  return String(e)
}

export function input(id: Parameters<typeof el>[0]): HTMLInputElement {
  return el(id) as HTMLInputElement
}
export function select(id: Parameters<typeof el>[0]): HTMLSelectElement {
  return el(id) as HTMLSelectElement
}
export function button(id: Parameters<typeof el>[0]): HTMLButtonElement {
  return el(id) as HTMLButtonElement
}

export function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function hbutton(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  return b
}
export function set_title(text: string | null, base: string): void {
  document.title = text == null ? base : text + ' – ' + base
}
export function is_visible(): boolean {
  return document.visibilityState === 'visible'
}
export function on_visibility(fn: () => void): void {
  document.addEventListener('visibilitychange', fn)
}
