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
import * as musicxml from './07_musicxml.js'
import * as st from './01_state.js'
import * as util from './00_util.js'

export let osmd: OsmdInstance | null = null

export let hidden_osmd: OsmdInstance | null = null

export let layout: import('./07_musicxml.js').MeasureCell[] | null = null

export let mpp = 4

export let render_seq = 0

export function init() {
  if (osmd) return
  if (!window.opensheetmusicdisplay) {
    util.toast('楽譜ライブラリの読込に失敗しました')
    return
  }
  osmd = new window.opensheetmusicdisplay!.OpenSheetMusicDisplay(
    util.el('sheet_host'),
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

export function setup(quantized: Quantized, mpp: number) {
  let S = st.S
  layout = musicxml.layout_measures(quantized)
  mpp = mpp
  S.page_count = Math.max(1, Math.ceil(quantized.measure_count / mpp))
  S.page_index = 0
  S.zoom = default_zoom()
}

export function default_zoom() {
  let frame = util.el('sheet_frame')
  let w = frame ? frame.clientWidth : 900
  return util.clamp(w / 980, 0.5, 1.25)
}

export async function render_page() {
  let S = st.S
  let Q = S.quantized
  if (!Q) return
  init()
  if (!osmd) return

  let seq = ++render_seq
  let from = S.page_index * mpp
  let to = Math.min(Q.measure_count, from + mpp)
  let xml = musicxml.build(Q, {
    from: from,
    to: to,
    layout: layout || undefined,
  })

  try {
    await osmd!.load(xml)
    if (seq !== render_seq) return
    osmd!.zoom = S.zoom
    osmd!.render()
  } catch (e) {
    util.toast('楽譜の描画に失敗しました')
    return
  }

  collect_measure_boxes(from, to)

  util.el('page_indicator').textContent =
    S.page_index + 1 + ' / ' + S.page_count
  util.el('page_title').textContent =
    'ページ ' + (S.page_index + 1) + '（' + (from + 1) + '〜' + to + '小節）'
}

export function collect_measure_boxes(from: number, to: number) {
  let S = st.S
  S.measure_boxes = []
  try {
    const gs = (osmd!.GraphicSheet || osmd!.graphic)!
    const ml = (gs.MeasureList || gs.measureList)!
    let zoom = osmd!.zoom || 1
    let unit = 10 * zoom

    let off_x = 0,
      off_y = 0
    let wrap = util.el('sheet_wrap')
    const svg = util.qs('#sheet_host svg') as SVGSVGElement | null
    if (wrap && svg) {
      let wr = wrap.getBoundingClientRect()
      let sr = svg.getBoundingClientRect()
      off_x = sr.left - wr.left
      off_y = sr.top - wr.top
    }
    for (let i = 0; i < ml.length; i++) {
      let staff_measures = ml[i]
      let m = staff_measures && staff_measures[0]
      if (!m) continue
      let bb = m.PositionAndShape
      let x = bb.AbsolutePosition.x * unit
      let w = bb.Size.width * unit
      let y = 0,
        h = 0
      let sys = m.ParentMusicSystem || m.parentMusicSystem
      if (sys && sys.PositionAndShape) {
        y = sys.PositionAndShape.AbsolutePosition.y * unit
        h = sys.PositionAndShape.Size.height * unit
      }
      S.measure_boxes.push({
        measure: from + i,
        x: x + off_x,
        w: w,
        y: Math.max(0, y + off_y - 8),
        h: Math.max(40, h + 20),
      })
    }
  } catch (e) {
    S.measure_boxes = []
  }
}

export function time_to_measure(t: number) {
  let Q = st.S.quantized
  if (!Q) return null
  let tick = ((t - Q.phase) / Q.quarter_sec) * st.DIV
  if (tick < 0) tick = 0
  let measure = Math.floor(tick / Q.measure_div)
  let frac = (tick - measure * Q.measure_div) / Q.measure_div
  return { measure: measure, frac: util.clamp(frac, 0, 1) }
}

export function update_playhead(t: number, follow: boolean) {
  let S = st.S
  let head = util.el('playhead')
  let pos = time_to_measure(t)
  if (!pos || pos.measure >= (S.quantized ? S.quantized.measure_count : 0)) {
    head.classList.add('is-hidden')
    return
  }

  let page = Math.floor(pos.measure / mpp)
  if (page !== S.page_index) {
    if (follow) {
      S.page_index = page
      render_page()
    }
    head.classList.add('is-hidden')
    return
  }

  let box = null
  for (let i = 0; i < S.measure_boxes.length; i++) {
    if (S.measure_boxes[i].measure === pos.measure) {
      box = S.measure_boxes[i]
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
    let frame = util.el('sheet_frame')
    let target = box.y - 40
    if (Math.abs(frame.scrollTop - target) > box.h) {
      frame.scrollTop = Math.max(0, target)
    }
  }
}

export async function export_pdf(
  on_progress: ((r: number, text: string) => void) | null,
) {
  let S = st.S
  let Q = S.quantized
  if (!Q) return
  if (!window.jspdf || !window.jspdf.jsPDF) {
    util.toast('PDFライブラリの読込に失敗しました')
    return
  }

  if (!hidden_osmd) {
    hidden_osmd = new window.opensheetmusicdisplay!.OpenSheetMusicDisplay(
      util.el('hidden_sheet'),
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

  for (let page = 0; page < S.page_count; page++) {
    if (on_progress)
      on_progress(
        page / S.page_count,
        'PDF作成中… ' + (page + 1) + '/' + S.page_count,
      )
    let from = page * mpp
    let to = Math.min(Q.measure_count, from + mpp)
    let xml = musicxml.build(Q, {
      from: from,
      to: to,
      layout: layout || undefined,
    })
    await hidden_osmd!.load(xml)
    hidden_osmd!.zoom = 1
    hidden_osmd!.render()

    const svg = util.qs('#hidden_sheet svg') as SVGSVGElement | null
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
  if (on_progress) on_progress(1, 'PDF作成完了')
  return pdf.output('blob')
}
