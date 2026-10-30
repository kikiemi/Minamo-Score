interface OsmdBoundingBox {
  AbsolutePosition: { x: number; y: number }
  Size: { width: number; height: number }
}

interface OsmdMeasure {
  PositionAndShape: OsmdBoundingBox
  ParentMusicSystem?: { PositionAndShape?: OsmdBoundingBox }
  parentMusicSystem?: { PositionAndShape?: OsmdBoundingBox }
}

interface OsmdGraphicSheet {
  MeasureList?: OsmdMeasure[][]
  measureList?: OsmdMeasure[][]
}

interface OsmdInstance {
  load(xml: string): Promise<void>
  render(): void
  zoom: number
  GraphicSheet?: OsmdGraphicSheet
  graphic?: OsmdGraphicSheet
}

interface OsmdNamespace {
  OpenSheetMusicDisplay: new (
    host: HTMLElement,
    opts: Record<string, unknown>,
  ) => OsmdInstance
}

interface JsPdfInstance {
  internal: { pageSize: { getWidth(): number; getHeight(): number } }
  addPage(): void
  svg(
    el: Element,
    opts: { x: number; y: number; width: number; height: number },
  ): Promise<void>
  save(name: string): void
  output(kind: 'blob'): Blob
}

interface JsPdfNamespace {
  jsPDF: new (opts: Record<string, unknown>) => JsPdfInstance
}

interface Window {
  opensheetmusicdisplay?: OsmdNamespace
  jspdf?: JsPdfNamespace
  webkitAudioContext?: typeof AudioContext
}

declare const opensheetmusicdisplay: OsmdNamespace
