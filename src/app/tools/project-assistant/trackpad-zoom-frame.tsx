'use client';

import { useEffect, useRef, useState } from 'react';
import type { DriveItemKind } from '@/lib/projects/historical-projects-data';

type TrackpadZoomFrameProps = {
  src: string;
  title: string;
  kind?: DriveItemKind;
  isEditMode?: boolean;
  heightClassName?: string;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Universal interactive zoom & pan viewport for all embedded file types
 * (PDF, spreadsheets, presentations, documents, images, and media):
 *
 * Supports:
 * 1. Trackpad two-finger pinch-to-zoom (`ctrlKey`/`metaKey` wheel & Safari `GestureEvent`).
 * 2. Mouse wheel zoom (`Ctrl`/`Cmd`/`Alt` + mouse wheel, or discrete line-mode mouse wheel).
 * 3. Touch two-finger pinch-to-zoom & single-finger pan on touchscreens / tablets.
 * 4. Two-finger trackpad scroll pan or left/middle-mouse click-and-drag pan when zoomed in.
 * 5. Double-click to toggle zoom (100% <-> 200%).
 * 6. Strict scroll-isolation: forceful two-finger trackpad swipes inside presentations/documents
 *    never chain or leak to the outer page list below.
 */
export function TrackpadZoomFrame({
  src,
  title,
  isEditMode = false,
  heightClassName = 'h-[640px]',
}: TrackpadZoomFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isPointerInsideRef = useRef(false);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState<'zoom_pan' | 'iframe_native'>('zoom_pan');
  const [passThroughToIframe, setPassThroughToIframe] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const touchStateRef = useRef<{
    lastDist: number | null;
    lastCenter: { x: number; y: number } | null;
  }>({ lastDist: null, lastCenter: null });
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passThroughTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset zoom and switch interactive mode appropriately when switching files or toggling edit mode
  useEffect(() => {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setPassThroughToIframe(false);
    setInteractiveMode(isEditMode ? 'iframe_native' : 'zoom_pan');
  }, [src, isEditMode]);

  // Lock ALL ancestor scroll containers AND document scroll while pointer is inside the viewer
  // so forceful trackpad swipes / inertial momentum inside a presentation/PDF NEVER scroll-chain
  // or jump out to move the file list below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    type LockedScrollState = {
      el: HTMLElement;
      savedOverflowY: string;
      savedOverscrollBehavior: string;
      savedPaddingRight: string;
      lockedScrollTop: number;
      lockedScrollLeft: number;
      onScrollGuard: () => void;
    };

    let lockedAncestors: LockedScrollState[] = [];
    let isLocked = false;
    let isRestoringScroll = false;

    function getScrollableAncestors(start: HTMLElement): HTMLElement[] {
      const list: HTMLElement[] = [];
      let curr: HTMLElement | null = start.parentElement;
      while (curr) {
        const style = window.getComputedStyle(curr);
        const oy = style.overflowY;
        if (
          oy === 'auto' ||
          oy === 'scroll' ||
          oy === 'overlay' ||
          curr.scrollHeight > curr.clientHeight
        ) {
          list.push(curr);
        }
        curr = curr.parentElement;
      }
      if (typeof document !== 'undefined') {
        if (document.body && !list.includes(document.body)) list.push(document.body);
        if (document.documentElement && !list.includes(document.documentElement)) {
          list.push(document.documentElement);
        }
      }
      return list;
    }

    function lockOuterScroll() {
      if (isLocked || !container) return;
      const ancestors = getScrollableAncestors(container);
      lockedAncestors = ancestors.map((el) => {
        const lockedScrollTop = el.scrollTop;
        const lockedScrollLeft = el.scrollLeft;
        const savedOverflowY = el.style.overflowY;
        const savedOverscrollBehavior = el.style.overscrollBehavior;
        const savedPaddingRight = el.style.paddingRight;

        // Compensate scrollbar width so layout does not shift horizontally when overflowY is hidden
        const scrollbarWidth = el.offsetWidth - el.clientWidth;
        if (scrollbarWidth > 0 && el !== document.documentElement && el !== document.body) {
          const computedPaddingRight = parseFloat(window.getComputedStyle(el).paddingRight) || 0;
          el.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
        }

        el.style.overflowY = 'hidden';
        el.style.overscrollBehavior = 'none';

        const onScrollGuard = () => {
          if (isRestoringScroll) return;
          if (el.scrollTop !== lockedScrollTop || el.scrollLeft !== lockedScrollLeft) {
            isRestoringScroll = true;
            el.scrollTop = lockedScrollTop;
            el.scrollLeft = lockedScrollLeft;
            isRestoringScroll = false;
          }
        };
        el.addEventListener('scroll', onScrollGuard, { passive: true });

        return {
          el,
          savedOverflowY,
          savedOverscrollBehavior,
          savedPaddingRight,
          lockedScrollTop,
          lockedScrollLeft,
          onScrollGuard,
        };
      });
      isLocked = true;
    }

    function unlockOuterScroll() {
      if (!isLocked) return;
      for (const item of lockedAncestors) {
        item.el.removeEventListener('scroll', item.onScrollGuard);
        item.el.style.overflowY = item.savedOverflowY;
        item.el.style.overscrollBehavior = item.savedOverscrollBehavior;
        item.el.style.paddingRight = item.savedPaddingRight;
        item.el.scrollTop = item.lockedScrollTop;
        item.el.scrollLeft = item.lockedScrollLeft;
      }
      lockedAncestors = [];
      isLocked = false;
    }

    function onEnter() {
      isPointerInsideRef.current = true;
      lockOuterScroll();
    }

    function onLeave() {
      isPointerInsideRef.current = false;
      unlockOuterScroll();
    }

    // Also catch any pointer/wheel motion over the container in case pointer started inside it
    function onPointerOver() {
      if (!isPointerInsideRef.current) {
        isPointerInsideRef.current = true;
        lockOuterScroll();
      }
    }

    // Global capture-phase wheel guard: if the pointer is inside the viewer, block any wheel event
    // that bubbles or targets outside the iframe from reaching ancestor scroll containers.
    function onWindowWheelCapture(e: WheelEvent) {
      if (!isPointerInsideRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      const insideBounds =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (insideBounds) {
        if (!isLocked) lockOuterScroll();
        // Restore locked scroll positions immediately if browser compositor attempted scroll chaining
        for (const item of lockedAncestors) {
          if (item.el.scrollTop !== item.lockedScrollTop) {
            item.el.scrollTop = item.lockedScrollTop;
          }
        }
      }
    }

    container.addEventListener('mouseenter', onEnter);
    container.addEventListener('mouseleave', onLeave);
    container.addEventListener('pointermove', onPointerOver, { passive: true });
    window.addEventListener('wheel', onWindowWheelCapture, { capture: true, passive: false });

    return () => {
      container.removeEventListener('mouseenter', onEnter);
      container.removeEventListener('mouseleave', onLeave);
      container.removeEventListener('pointermove', onPointerOver);
      window.removeEventListener('wheel', onWindowWheelCapture, { capture: true });
      unlockOuterScroll();
    };
  }, []);

  function applyZoomAtPoint(factor: number, clientX: number, clientY: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = clientX - (rect.left + rect.width / 2);
    const cy = clientY - (rect.top + rect.height / 2);

    const prevScale = scaleRef.current;
    const nextScale = clamp(prevScale * factor, MIN_SCALE, MAX_SCALE);

    if (Math.abs(nextScale - 1) < 0.015) {
      scaleRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const ratio = nextScale / prevScale;
    const maxPanX = Math.max(0, ((nextScale - 1) * rect.width) / 2 + rect.width * 0.25);
    const maxPanY = Math.max(0, ((nextScale - 1) * rect.height) / 2 + rect.height * 0.25);
    const nx = clamp(cx - (cx - offsetRef.current.x) * ratio, -maxPanX, maxPanX);
    const ny = clamp(cy - (cy - offsetRef.current.y) * ratio, -maxPanY, maxPanY);

    scaleRef.current = nextScale;
    offsetRef.current = { x: nx, y: ny };
    setScale(nextScale);
    setOffset({ x: nx, y: ny });
  }

  function stepZoom(factor: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    applyZoomAtPoint(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function resetZoom() {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function markInteracting() {
      setIsInteracting(true);
      if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
      interactionTimeoutRef.current = setTimeout(() => {
        setIsInteracting(false);
      }, 220);
    }

    function openIframeScrollWindow() {
      setPassThroughToIframe(true);
      if (passThroughTimeoutRef.current) clearTimeout(passThroughTimeoutRef.current);
      // Keep pass-through active long enough for continuous multi-swipe reading across slides
      passThroughTimeoutRef.current = setTimeout(() => {
        setPassThroughToIframe(false);
      }, 2800);
    }

    function onWheel(e: WheelEvent) {
      if (!container) return;

      // Always prevent wheel events inside the viewer from bubbling/scrolling the outer page!
      e.preventDefault();
      e.stopPropagation();

      // Detect trackpad pinch (ctrlKey), modifier+wheel (metaKey/altKey),
      // or true line-mode discrete mouse wheel (deltaMode === 1).
      // NOTE: Never use Math.abs(e.deltaY) >= 40 here because a forceful trackpad two-finger swipe
      // has deltaMode === 0 and deltaY >= 40!
      const isModifierPinch = e.ctrlKey || e.metaKey || e.altKey;
      const isDiscreteMouseWheel = e.deltaMode === 1;

      // 1. Trackpad pinch OR Ctrl/Cmd/Alt + mouse wheel OR discrete line-mode mouse wheel
      if (isModifierPinch || (interactiveMode === 'zoom_pan' && isDiscreteMouseWheel)) {
        setPassThroughToIframe(false);
        markInteracting();
        const sensitivity = e.ctrlKey ? 0.014 : 0.0035;
        const zoomFactor = Math.exp(-e.deltaY * sensitivity);
        applyZoomAtPoint(zoomFactor, e.clientX, e.clientY);
        return;
      }

      // 2. When zoomed in (scale !== 1), two-finger trackpad scroll pans smoothly in 2D
      if (Math.abs(scaleRef.current - 1) > 0.02) {
        markInteracting();
        const rect = container.getBoundingClientRect();
        const maxPanX = Math.max(0, ((scaleRef.current - 1) * rect.width) / 2 + rect.width * 0.25);
        const maxPanY = Math.max(0, ((scaleRef.current - 1) * rect.height) / 2 + rect.height * 0.25);
        const nx = clamp(offsetRef.current.x - e.deltaX, -maxPanX, maxPanX);
        const ny = clamp(offsetRef.current.y - e.deltaY, -maxPanY, maxPanY);
        offsetRef.current = { x: nx, y: ny };
        setOffset({ x: nx, y: ny });
        return;
      }

      // 3. At 100% zoom, two-finger trackpad scroll (gentle or forceful) passes through to the iframe
      openIframeScrollWindow();
    }

    // Safari macOS native GestureEvents for trackpad pinch
    let lastGestureScale = 1;
    function onGestureStart(e: Event) {
      e.preventDefault();
      e.stopPropagation();
      lastGestureScale = 1;
      setPassThroughToIframe(false);
      markInteracting();
    }

    function onGestureChange(e: Event) {
      e.preventDefault();
      e.stopPropagation();
      setPassThroughToIframe(false);
      markInteracting();
      const ge = e as unknown as { scale: number; clientX?: number; clientY?: number };
      if (typeof ge.scale === 'number' && ge.scale > 0) {
        const factor = ge.scale / lastGestureScale;
        lastGestureScale = ge.scale;
        const rect = container?.getBoundingClientRect();
        const cx = ge.clientX ?? (rect ? rect.left + rect.width / 2 : 0);
        const cy = ge.clientY ?? (rect ? rect.top + rect.height / 2 : 0);
        applyZoomAtPoint(factor, cx, cy);
      }
    }

    function onGestureEnd(e: Event) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Touch pinch-to-zoom & single-finger pan for touch screens / trackpad touch emulation
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        setPassThroughToIframe(false);
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        touchStateRef.current = { lastDist: dist, lastCenter: center };
      } else if (e.touches.length === 1 && Math.abs(scaleRef.current - 1) > 0.02) {
        const t = e.touches[0];
        dragStartRef.current = {
          x: t.clientX,
          y: t.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!container) return;
      if (e.touches.length === 2 && touchStateRef.current.lastDist) {
        e.preventDefault();
        markInteracting();
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const factor = dist / touchStateRef.current.lastDist;
        touchStateRef.current = { lastDist: dist, lastCenter: center };
        applyZoomAtPoint(factor, center.x, center.y);
      } else if (e.touches.length === 1 && dragStartRef.current && Math.abs(scaleRef.current - 1) > 0.02) {
        e.preventDefault();
        markInteracting();
        const t = e.touches[0];
        const rect = container.getBoundingClientRect();
        const maxPanX = Math.max(0, ((scaleRef.current - 1) * rect.width) / 2 + rect.width * 0.25);
        const maxPanY = Math.max(0, ((scaleRef.current - 1) * rect.height) / 2 + rect.height * 0.25);
        const nx = clamp(dragStartRef.current.ox + (t.clientX - dragStartRef.current.x), -maxPanX, maxPanX);
        const ny = clamp(dragStartRef.current.oy + (t.clientY - dragStartRef.current.y), -maxPanY, maxPanY);
        offsetRef.current = { x: nx, y: ny };
        setOffset({ x: nx, y: ny });
      }
    }

    function onTouchEnd() {
      touchStateRef.current = { lastDist: null, lastCenter: null };
      dragStartRef.current = null;
    }

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('gesturestart', onGestureStart, { passive: false });
    container.addEventListener('gesturechange', onGestureChange, { passive: false });
    container.addEventListener('gestureend', onGestureEnd, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('gesturestart', onGestureStart);
      container.removeEventListener('gesturechange', onGestureChange);
      container.removeEventListener('gestureend', onGestureEnd);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
      if (passThroughTimeoutRef.current) clearTimeout(passThroughTimeoutRef.current);
    };
  }, [interactiveMode]);

  const isZoomed = Math.abs(scale - 1) > 0.02;

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => {
        if (isDragging && dragStartRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const maxPanX = Math.max(0, ((scaleRef.current - 1) * rect.width) / 2 + rect.width * 0.25);
          const maxPanY = Math.max(0, ((scaleRef.current - 1) * rect.height) / 2 + rect.height * 0.25);
          const dx = e.clientX - dragStartRef.current.x;
          const dy = e.clientY - dragStartRef.current.y;
          const nx = clamp(dragStartRef.current.ox + dx, -maxPanX, maxPanX);
          const ny = clamp(dragStartRef.current.oy + dy, -maxPanY, maxPanY);
          offsetRef.current = { x: nx, y: ny };
          setOffset({ x: nx, y: ny });
        }
      }}
      onMouseUp={() => {
        setIsDragging(false);
        dragStartRef.current = null;
      }}
      onMouseLeave={() => {
        setIsDragging(false);
        dragStartRef.current = null;
      }}
      className={`relative w-full overflow-hidden overscroll-contain bg-slate-950 select-none ${heightClassName}`}
      style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
    >
      {/* Zoomed & panned iframe stage (works for PDF, Sheets, Slides, Docs, Images, etc.) */}
      <div
        className="h-full w-full origin-center will-change-transform"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transition: isInteracting || isDragging ? 'none' : 'transform 100ms ease-out',
        }}
      >
        <iframe
          src={src}
          title={title}
          className="h-full w-full border-0 bg-white overscroll-contain"
          allow="autoplay"
        />
      </div>

      {/*
        Gesture & Mouse Capture Surface:
        - Captures trackpad two-finger pinch, mouse wheel zoom, click-drag pan, and double-click zoom
          across ALL file types (PDF, Excel/Sheets, PPT/Slides, Word/Docs, Images).
        - Leaves bottom 56px uncovered at 100% zoom so native Google Drive page/sheet tabs remain clickable,
          and yields when the user scrolls or switches to `iframe_native` mode.
      */}
      {interactiveMode === 'zoom_pan' && (
        <div
          aria-hidden
          onDoubleClick={(e) => {
            if (isZoomed) {
              resetZoom();
            } else {
              applyZoomAtPoint(2, e.clientX, e.clientY);
            }
          }}
          onMouseDown={(e) => {
            if (!isZoomed && e.button === 0) {
              // Single click at 100% lets the user interact & scroll inside spreadsheet tabs / slides
              setPassThroughToIframe(true);
              if (passThroughTimeoutRef.current) clearTimeout(passThroughTimeoutRef.current);
              passThroughTimeoutRef.current = setTimeout(() => {
                setPassThroughToIframe(false);
              }, 2800);
              return;
            }
            setIsDragging(true);
            dragStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              ox: offsetRef.current.x,
              oy: offsetRef.current.y,
            };
          }}
          className={`absolute inset-x-0 top-0 z-10 bg-transparent ${
            isZoomed ? 'bottom-0' : 'bottom-14'
          } ${
            !isZoomed && passThroughToIframe
              ? 'pointer-events-none'
              : 'pointer-events-auto'
          } ${isZoomed ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
        />
      )}

      {/* Minimal Floating Icon Zoom Controls (bottom-right) for mouse & trackpad users */}
      <div className="absolute bottom-3.5 right-3.5 z-20 flex items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-900/90 p-1 text-slate-200 shadow-lg backdrop-blur-xs">
        <button
          type="button"
          onClick={() => stepZoom(1 / 1.25)}
          title="縮小 (支援觸控板雙指捏合 / 滑鼠滾輪)"
          aria-label="縮小"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-800 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </button>

        <button
          type="button"
          onClick={resetZoom}
          title="點擊重設為 100%"
          className="min-w-[46px] rounded-md px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-slate-200 hover:bg-slate-800 hover:text-white"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          onClick={() => stepZoom(1.25)}
          title="放大 (支援觸控板雙指張開 / 滑鼠滾輪)"
          aria-label="放大"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-800 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() =>
            setInteractiveMode((m) => (m === 'zoom_pan' ? 'iframe_native' : 'zoom_pan'))
          }
          title={
            interactiveMode === 'zoom_pan'
              ? '目前：觸控板／滑鼠滾輪縮放與拖曳模式（點擊切換為內部表格／簡報點擊模式）'
              : '目前：內部表格／簡報點擊模式（點擊切回觸控板／滑鼠縮放模式）'
          }
          aria-label="切換縮放或內部操作模式"
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition ${
            interactiveMode === 'zoom_pan'
              ? 'bg-td-blue text-white'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zm0-11v6m-3-3h6"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
