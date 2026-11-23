'use client';

import { useMemo, useState } from 'react';
import { inputCls } from './form-fields';

export type CascadingBudgetItem = {
  id: string;
  label: string;
  /** 第一層分組名稱（部門名稱或專案名稱），若未提供則自動從 label 解析 */
  groupName?: string;
  /** 第二層科目／預算項目顯示名稱，若未提供則使用 label */
  itemLabel?: string;
};

/**
 * 從既有 label（例如 `管理部：吳旭東（旅費｜116ADSE03）` 或 `116ADSE03｜管理部｜旅費`）
 * 自動解析出「第一層（部門／專案）」與「第二層（科目類別／預算編號）」
 */
export function normalizeCascadingBudgetItem(raw: CascadingBudgetItem): {
  id: string;
  label: string;
  groupName: string;
  itemLabel: string;
} {
  if (raw.groupName && raw.itemLabel) {
    return {
      id: raw.id,
      label: raw.label,
      groupName: raw.groupName,
      itemLabel: raw.itemLabel,
    };
  }
  const label = raw.label.trim();
  // Pattern 1: "管理部：吳旭東（差旅費｜B-001）" or "高雄自駕車：劉君怡"
  const colonIdx = label.indexOf('：');
  if (colonIdx > 0) {
    const groupName = raw.groupName || label.slice(0, colonIdx).trim();
    const rest = label.slice(colonIdx + 1).trim();
    return {
      id: raw.id,
      label: raw.label,
      groupName,
      itemLabel: raw.itemLabel || rest || label,
    };
  }
  // Pattern 2: "115ADSE01｜管理部｜人事費"
  const parts = label.split('｜').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      id: raw.id,
      label: raw.label,
      groupName: raw.groupName || parts[1]!,
      itemLabel: raw.itemLabel || `${parts[2]}（${parts[0]}）`,
    };
  }
  return {
    id: raw.id,
    label: raw.label,
    groupName: raw.groupName || '通用預算',
    itemLabel: raw.itemLabel || label,
  };
}

/**
 * 兩層級聯預算選單（第 10 條：費用申請改成兩層預算選單）
 * - 第一層：選擇「部門／專案（預算歸屬單位）」
 * - 第二層：選擇該單位下之「預算科目／預算編號（含預算負責人）」
 */
export function TwoTierBudgetSelect({
  value,
  onChange,
  options,
  className,
  ariaLabelledBy,
  ariaLabel,
  ariaInvalid,
  compact = false,
}: {
  value: string;
  onChange: (budgetCodeId: string) => void;
  options: CascadingBudgetItem[];
  className?: string;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  compact?: boolean;
}) {
  const normalized = useMemo(() => options.map(normalizeCascadingBudgetItem), [options]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof normalized>();
    for (const item of normalized) {
      const list = map.get(item.groupName) ?? [];
      list.push(item);
      map.set(item.groupName, list);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [normalized]);

  const selectedItem = useMemo(
    () => normalized.find((item) => item.id === value) ?? null,
    [normalized, value]
  );

  const [manualGroup, setManualGroup] = useState<string>('');
  const activeGroup = selectedItem?.groupName ?? (manualGroup || (groups[0]?.name ?? ''));

  const tier2Items = useMemo(() => {
    if (!activeGroup) return normalized;
    const found = groups.find((g) => g.name === activeGroup);
    return found ? found.items : normalized;
  }, [activeGroup, groups, normalized]);

  const selectCls = className ?? `${inputCls} !bg-white`;

  if (groups.length <= 1) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
      >
        <option value="">請選擇預算科目／預算編號</option>
        {normalized.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className={compact ? 'grid grid-cols-1 gap-1' : 'grid grid-cols-1 gap-2 sm:grid-cols-2'}>
      <div>
        {!compact && (
          <span className="mb-1 block text-xs font-medium text-td-muted">
            第一層：部門／專案單位
          </span>
        )}
        <select
          value={activeGroup}
          onChange={(e) => {
            const nextGroup = e.target.value;
            setManualGroup(nextGroup);
            const groupObj = groups.find((g) => g.name === nextGroup);
            if (groupObj && groupObj.items.length > 0) {
              onChange(groupObj.items[0]!.id);
            } else {
              onChange('');
            }
          }}
          aria-label={ariaLabel ? `${ariaLabel}（第一層：部門或專案）` : '預算第一層：部門或專案'}
          className={selectCls}
        >
          <option value="">請選擇部門／專案</option>
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name}（{g.items.length} 項科目）
            </option>
          ))}
        </select>
      </div>

      <div>
        {!compact && (
          <span className="mb-1 block text-xs font-medium text-td-muted">
            第二層：預算科目／編號（負責人）
          </span>
        )}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={selectCls}
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
        >
          <option value="">請選擇預算科目／編號</option>
          {tier2Items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.itemLabel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
