'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MultiSelectOption = {
  value: string;
  label: string;
};

type Props = {
  options: Array<string | MultiSelectOption>;
  selected: string[];
  onChange: (next: string[]) => void;
  keyword?: string;
  onKeywordChange?: (nextKeyword: string) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
};

/**
 * 判斷資料列是否符合「多選勾選 + 即時輸入文字」雙重過濾條件：
 * - 若有勾選項目且亦有輸入關鍵字：只要符合已勾選項目，或符合目前正在鍵入的關鍵字即顯示（邊打字邊即時更新下方清單）
 * - 若僅有勾選項目：必須屬於已勾選項目
 * - 若未勾選任何項目但有鍵入文字：依鍵入文字即時模糊比對逐步更新下方清單
 */
export function matchesMultiSelectFilter(
  rowValue: string,
  selected: string[],
  keyword?: string,
  rowLabel?: string
): boolean {
  const q = (keyword ?? '').trim().toLowerCase();
  const hasSelected = selected.length > 0;
  const hasKeyword = q.length > 0;

  if (!hasSelected && !hasKeyword) return true;

  const valLower = (rowValue ?? '').toLowerCase();
  const labelLower = (rowLabel ?? rowValue ?? '').toLowerCase();
  const matchesKw = hasKeyword && (valLower.includes(q) || labelLower.includes(q));

  if (hasSelected && !hasKeyword) {
    return selected.includes(rowValue);
  }
  if (!hasSelected && hasKeyword) {
    return matchesKw;
  }
  // 同時有已勾選項目且使用者正在鍵入新關鍵字時：只顯示符合目前勾選或正在搜尋的項目
  return selected.includes(rowValue) || matchesKw;
}

function highlightMatch(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="rounded bg-amber-200/80 px-0.5 font-bold text-slate-900">
        {match}
      </mark>
      {after}
    </>
  );
}

export function MultiSelectFilter({
  options,
  selected,
  onChange,
  keyword: controlledKeyword,
  onKeywordChange,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [internalKeyword, setInternalKeyword] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 230,
  });

  const keyword = controlledKeyword !== undefined ? controlledKeyword : internalKeyword;
  const setKeyword = (val: string) => {
    setInternalKeyword(val);
    onKeywordChange?.(val);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const normalizedOptions = useMemo<MultiSelectOption[]>(
    () =>
      options.map((o) =>
        typeof o === 'string' ? { value: o, label: o } : o
      ),
    [options]
  );

  const labelByValue = useMemo(
    () => new Map(normalizedOptions.map((o) => [o.value, o.label])),
    [normalizedOptions]
  );

  const filteredOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [normalizedOptions, keyword]);

  const updateCoords = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const minW = Math.max(rect.width, 236);
    const maxLeft = Math.max(8, window.innerWidth - minW - 12);
    setCoords({
      top: rect.bottom + 4,
      left: Math.min(rect.left, maxLeft),
      width: minW,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        popRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        headerInputRef.current?.blur();
      }
    };
    const onReposition = () => updateCoords();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  const toggleValue = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((x) => x !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const selectAllFiltered = () => {
    const vals = filteredOptions.map((o) => o.value);
    onChange([...new Set([...selected, ...vals])]);
  };

  const clearAll = () => {
    onChange([]);
    setKeyword('');
  };

  const summaryText = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      return labelByValue.get(selected[0]!) ?? selected[0]!;
    }
    if (selected.length === 2) {
      return selected.map((v) => labelByValue.get(v) ?? v).join('、');
    }
    const first = labelByValue.get(selected[0]!) ?? selected[0]!;
    return `${first} 等 ${selected.length} 項`;
  }, [selected, placeholder, labelByValue]);

  const isFiltered = selected.length > 0 || keyword.trim().length > 0;

  return (
    <>
      <div
        ref={containerRef}
        onClick={() => {
          if (!open) setOpen(true);
          headerInputRef.current?.focus();
        }}
        className={`mt-1.5 flex w-full cursor-text items-center justify-between gap-1 rounded-md border px-2 py-1 text-left text-[11px] font-normal transition ${
          isFiltered
            ? 'border-td-blue bg-blue-50/70 text-td-blue-dark ring-1 ring-td-blue/30'
            : open
            ? 'border-td-blue bg-white text-slate-800 ring-1 ring-td-blue/25'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
        } ${className ?? ''}`}
      >
        <input
          ref={headerInputRef}
          type="text"
          value={keyword}
          aria-label={ariaLabel ?? placeholder}
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            if (!open) setOpen(true);
            setKeyword(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filteredOptions.length === 1) {
              e.preventDefault();
              toggleValue(filteredOptions[0]!.value);
            }
          }}
          placeholder={selected.length > 0 ? `已選：${summaryText}` : placeholder}
          className={`w-full min-w-0 bg-transparent text-[11px] focus:outline-none ${
            selected.length > 0 && !keyword
              ? 'placeholder:font-semibold placeholder:text-td-blue-dark'
              : 'placeholder:text-slate-500'
          } ${inputClassName ?? ''}`}
        />
        <span className="flex shrink-0 items-center gap-1">
          {selected.length > 0 && (
            <span
              title={`已勾選 ${selected.length} 項`}
              className="rounded-full bg-td-blue px-1.5 py-0.2 text-[10px] font-bold text-white"
            >
              {selected.length}
            </span>
          )}
          {isFiltered && (
            <button
              type="button"
              title="清除此欄過濾"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              className="rounded px-0.5 text-[11px] font-bold text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              ×
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label="展開或收合選項"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="text-[10px] text-slate-400 hover:text-slate-600"
          >
            ▾
          </button>
        </span>
      </div>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              minWidth: coords.width,
              maxWidth: 320,
            }}
            className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl"
          >
            {/* 頂部即時關鍵字輸入與全選／清除 */}
            <div className="space-y-1.5 border-b border-slate-100 bg-slate-50/90 p-2">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredOptions.length === 1) {
                      e.preventDefault();
                      toggleValue(filteredOptions[0]!.value);
                    }
                  }}
                  placeholder="輸入文字即時過濾選項與下方清單..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1 pl-2 pr-6 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-td-blue focus:outline-none"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    className="absolute right-1.5 text-xs font-bold text-slate-400 hover:text-slate-600"
                    title="清除輸入文字"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* 已選標籤快覽 */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {selected.map((val) => (
                    <span
                      key={val}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100/90 px-2 py-0.5 text-[10px] font-semibold text-td-blue-dark"
                    >
                      <span className="max-w-[110px] truncate">
                        {labelByValue.get(val) ?? val}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleValue(val)}
                        className="text-td-blue-dark/70 hover:text-td-blue-dark"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-500">
                  符合 {filteredOptions.length} 項 · 已選 {selected.length} 項
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    disabled={filteredOptions.length === 0}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    {keyword.trim() ? `全選符合 (${filteredOptions.length})` : '全選'}
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
                  >
                    清除
                  </button>
                </div>
              </div>
            </div>

            {/* 核取方塊清單（隨輸入文字逐步更新） */}
            <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
              {filteredOptions.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-slate-400">
                  無符合「{keyword}」的選項
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                        checked
                          ? 'bg-blue-50/80 font-semibold text-td-blue-dark'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleValue(opt.value)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-td-blue"
                      />
                      <span className="truncate">
                        {highlightMatch(opt.label, keyword)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
