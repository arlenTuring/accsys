export type EditorTool =
  | 'select'
  | 'text'
  | 'image'
  | 'rect'
  | 'highlight'
  | 'note'
  | 'stamp';

export type StampKind =
  | 'check'
  | 'cross'
  | 'square'
  | 'square_fill'
  | 'circle'
  | 'circle_fill'
  | 'checkbox'
  | 'line'
  | 'arrow';

export type AnnotationBase = {
  id: string;
  pageIndex: number;
  /** Position / size as fraction of page (0–1) */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextAnnotation = AnnotationBase & {
  type: 'text';
  content: string;
  color: string;
  fontSize: number;
  bold?: boolean;
};

export type ImageAnnotation = AnnotationBase & {
  type: 'image';
  src: string;
};

export type RectAnnotation = AnnotationBase & {
  type: 'rect';
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
};

export type HighlightAnnotation = AnnotationBase & {
  type: 'highlight';
  color: string;
};

export type NoteAnnotation = AnnotationBase & {
  type: 'note';
  content: string;
  color: string;
};

export type StampAnnotation = AnnotationBase & {
  type: 'stamp';
  kind: StampKind;
  color: string;
};

export type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | RectAnnotation
  | HighlightAnnotation
  | NoteAnnotation
  | StampAnnotation;

export type PageSize = {
  width: number;
  height: number;
};

export type StampPreset = {
  kind: StampKind;
  label: string;
  /** Default size as fraction of page width (square-ish) */
  defaultSize: number;
};

export const STAMP_PRESETS: StampPreset[] = [
  { kind: 'check', label: '勾勾 ✓', defaultSize: 0.035 },
  { kind: 'cross', label: '叉叉 ✕', defaultSize: 0.035 },
  { kind: 'checkbox', label: '核取框 ☐', defaultSize: 0.03 },
  { kind: 'square', label: '空心黑框', defaultSize: 0.04 },
  { kind: 'square_fill', label: '實心黑塊', defaultSize: 0.03 },
  { kind: 'circle', label: '空心圓 ○', defaultSize: 0.035 },
  { kind: 'circle_fill', label: '實心圓 ●', defaultSize: 0.03 },
  { kind: 'line', label: '底線', defaultSize: 0.12 },
  { kind: 'arrow', label: '箭頭 →', defaultSize: 0.05 },
];

export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_HIGHLIGHT = '#E8A838';
export const DEFAULT_RECT_STROKE = '#1B6FD1';
export const DEFAULT_NOTE_COLOR = '#FEF6E8';
export const DEFAULT_STAMP_COLOR = '#111111';
