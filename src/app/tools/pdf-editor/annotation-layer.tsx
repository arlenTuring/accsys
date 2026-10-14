'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { StampGlyph } from './stamps';
import type { Annotation } from './types';

type Props = {
  annotation: Annotation;
  selected: boolean;
  editable: boolean;
  pageWidth: number;
  pageHeight: number;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onChange: (next: Annotation) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
};

export function AnnotationLayer({
  annotation,
  selected,
  editable,
  pageWidth,
  pageHeight,
  onSelect,
  onDeselect,
  onChange,
  onDelete,
  onDuplicate,
}: Props) {
  const annRef = useRef(annotation);
  useLayoutEffect(() => {
    annRef.current = annotation;
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const left = annotation.x * pageWidth;
  const top = annotation.y * pageHeight;
  const width = Math.max(24, annotation.width * pageWidth);
  const height = Math.max(20, annotation.height * pageHeight);

  const needsHandle = annotation.type === 'text' || annotation.type === 'note';
  const textIdle = annotation.type === 'text' && !selected;
  const stampIdle = annotation.type === 'stamp' && !selected;

  useEffect(() => {
    if (selected && annotation.type === 'text') {
      textareaRef.current?.focus();
    }
  }, [selected, annotation.type]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(annotation.id);

      const start = {
        mx: e.clientX,
        my: e.clientY,
        x: annRef.current.x,
        y: annRef.current.y,
      };

      const move = (ev: PointerEvent) => {
        const cur = annRef.current;
        const dx = (ev.clientX - start.mx) / pageWidth;
        const dy = (ev.clientY - start.my) / pageHeight;
        onChange({
          ...cur,
          x: Math.min(1 - cur.width, Math.max(0, start.x + dx)),
          y: Math.min(1 - cur.height, Math.max(0, start.y + dy)),
        });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [annotation.id, editable, onChange, onSelect, pageHeight, pageWidth]
  );

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(annotation.id);
    const start = {
      mx: e.clientX,
      my: e.clientY,
      w: annRef.current.width,
      h: annRef.current.height,
    };

    const move = (ev: PointerEvent) => {
      const cur = annRef.current;
      const dw = (ev.clientX - start.mx) / pageWidth;
      const dh = (ev.clientY - start.my) / pageHeight;
      onChange({
        ...cur,
        width: Math.min(1 - cur.x, Math.max(0.04, start.w + dw)),
        height: Math.min(1 - cur.y, Math.max(0.03, start.h + dh)),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    if (!selected || !editable) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'TEXTAREA' || tag === 'INPUT';

      if (e.key === 'Escape') {
        e.preventDefault();
        onDeselect();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        e.preventDefault();
        onDelete(annotation.id);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onDuplicate(annotation.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annotation.id, editable, onDelete, onDeselect, onDuplicate, selected]);

  const shellClass = selected
    ? 'ring-2 ring-td-apex ring-offset-1'
    : textIdle || stampIdle
      ? 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-td-blue/40'
      : 'hover:ring-1 hover:ring-td-blue/40';

  return (
    <div
      className={`absolute ${shellClass}`}
      style={{ left, top, width, height }}
      onClick={(e) => {
        e.stopPropagation();
        if (editable) onSelect(annotation.id);
      }}
      onPointerDown={!needsHandle ? startDrag : undefined}
    >
      {/* 僅在「選取中」顯示拖曳／複製／完成列 */}
      {editable && selected && needsHandle && (
        <div
          className="absolute -top-5 left-0 right-0 z-10 flex h-5 cursor-grab items-center gap-1 rounded-t-md bg-td-blue-dark px-1.5 active:cursor-grabbing"
          onPointerDown={startDrag}
          title="拖曳移動"
        >
          <span className="text-[10px] font-medium text-white/90">⠿ 拖曳</span>
          <button
            type="button"
            className="ml-auto rounded px-1 text-[10px] text-white/80 hover:bg-white/15 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(annotation.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="複製 (⌘D)"
          >
            複製
          </button>
          <button
            type="button"
            className="rounded bg-td-apex px-1.5 text-[10px] font-semibold text-td-blue-dark hover:bg-td-apex-dark hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onDeselect();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="完成編輯（Esc）"
          >
            完成
          </button>
        </div>
      )}

      {annotation.type === 'text' &&
        (selected ? (
          <textarea
            ref={textareaRef}
            className="h-full w-full resize-none overflow-hidden border border-dashed border-td-blue/40 bg-white/80 p-1 outline-none"
            style={{
              color: annotation.color,
              fontSize: annotation.fontSize,
              fontWeight: annotation.bold ? 700 : 400,
              lineHeight: 1.25,
            }}
            value={annotation.content}
            disabled={!editable}
            onChange={(e) => onChange({ ...annotation, content: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="輸入文字…"
          />
        ) : (
          <div
            className="h-full w-full overflow-hidden whitespace-pre-wrap break-words bg-transparent p-1"
            style={{
              color: annotation.color,
              fontSize: annotation.fontSize,
              fontWeight: annotation.bold ? 700 : 400,
              lineHeight: 1.25,
            }}
          >
            {annotation.content || (editable ? '（空白文字，點一下編輯）' : '')}
          </div>
        ))}

      {annotation.type === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={annotation.src}
          alt=""
          className={`h-full w-full object-contain ${editable ? 'cursor-move' : ''}`}
          draggable={false}
        />
      )}

      {annotation.type === 'rect' && (
        <div
          className={`h-full w-full ${editable ? 'cursor-move' : ''}`}
          style={{
            border: `${annotation.strokeWidth}px solid ${annotation.strokeColor}`,
            background:
              annotation.fillColor === 'transparent'
                ? 'transparent'
                : `${annotation.fillColor}26`,
          }}
        />
      )}

      {annotation.type === 'highlight' && (
        <div
          className={`h-full w-full ${editable ? 'cursor-move' : ''}`}
          style={{ backgroundColor: `${annotation.color}59` }}
        />
      )}

      {annotation.type === 'note' && (
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-amber-400/60 shadow-sm"
          style={{ backgroundColor: annotation.color }}
        >
          {selected ? (
            <textarea
              className="min-h-0 flex-1 resize-none bg-transparent p-1.5 text-xs text-td-blue-dark outline-none"
              value={annotation.content}
              disabled={!editable}
              onChange={(e) => onChange({ ...annotation, content: e.target.value })}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="備註…"
            />
          ) : (
            <div className="flex-1 overflow-hidden whitespace-pre-wrap p-1.5 text-xs text-td-blue-dark">
              {annotation.content || (editable ? '（空白便利貼）' : '')}
            </div>
          )}
        </div>
      )}

      {annotation.type === 'stamp' && (
        <div className={`h-full w-full ${editable ? 'cursor-move' : ''}`}>
          <StampGlyph kind={annotation.kind} color={annotation.color} />
        </div>
      )}

      {editable && selected && (
        <>
          {!needsHandle && (
            <button
              type="button"
              className="absolute -top-5 right-0 z-10 rounded bg-td-blue-dark px-1.5 py-0.5 text-[10px] text-white/90 hover:bg-td-blue"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(annotation.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="複製 (⌘D)"
            >
              複製
            </button>
          )}
          <button
            type="button"
            data-resize
            aria-label="調整大小"
            className="absolute -bottom-1.5 -right-1.5 z-10 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-white bg-td-apex shadow"
            onPointerDown={onResizePointerDown}
          />
        </>
      )}
    </div>
  );
}
