'use client';

import type { AssetRegisterLink, ColumnType, FieldDef, FormSchema } from '@/lib/custom-forms/schema';
import { smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { allSchemaFields } from './designer-model';

type TableField = Extract<FieldDef, { type: 'table' }>;

const COLUMN_SLOTS: { key: keyof AssetRegisterLink['columns']; label: string; type: ColumnType; hint: string }[] = [
  { key: 'asset', label: '財產欄', type: 'asset', hint: '財產類型、必填、不可重複' },
  { key: 'reason', label: '異動原因欄', type: 'select', hint: '下拉選單；選項代碼為 custodian_change、lend、merge、sell、scrap、other' },
  { key: 'newCustodian', label: '新保管人員欄', type: 'employee', hint: '員工類型、必填' },
  { key: 'newLocation', label: '新保管地點欄', type: 'text', hint: '文字類型、必填' },
];

const PEOPLE_SLOTS: { key: keyof AssetRegisterLink['custodians']; label: string; optional?: boolean }[] = [
  { key: 'original', label: '原保管人' },
  { key: 'new', label: '新保管人' },
  { key: 'other', label: '其他保管人', optional: true },
];

/**
 * 財產清冊串接 settings: which table moves which assets and which employee
 * fields are the custodians. The schema parser checks types and required
 * flags when the draft is saved.
 */
export function AssetRegisterEditor({ schema, setSchema }: { schema: FormSchema; setSchema: (s: FormSchema) => void }) {
  const link = schema.assetRegister;
  const fields = allSchemaFields(schema);
  const tables = fields.filter((f): f is TableField => f.type === 'table');
  const employees = fields.filter((f) => f.type === 'employee');
  const table = tables.find((t) => t.id === link?.table);

  const update = (next: AssetRegisterLink | undefined) => {
    const out = { ...schema };
    if (next) out.assetRegister = next;
    else delete out.assetRegister;
    setSchema(out);
  };
  const pickColumn = (t: TableField, type: ColumnType) => t.columns.find((c) => c.type === type && !c.formula)?.id ?? '';
  const enable = () => {
    const t = tables[0];
    update({
      table: t?.id ?? '',
      columns: {
        asset: t ? pickColumn(t, 'asset') : '',
        reason: t ? pickColumn(t, 'select') : '',
        newCustodian: t ? pickColumn(t, 'employee') : '',
        newLocation: t ? pickColumn(t, 'text') : '',
      },
      custodians: { original: employees[0]?.id ?? '', new: employees[1]?.id ?? '', other: null },
    });
  };

  return (
    <div className="border-t border-dashed border-td-border pt-3">
      <label className="flex items-start gap-2 text-td-blue-dark">
        <input type="checkbox" className="mt-1" checked={!!link} onChange={(e) => (e.target.checked ? enable() : update(undefined))} />
        <span>
          財產清冊串接
          <span className="block text-xs text-td-muted">
            明細表每一列異動一項財產：送出時檢查財產仍在清冊、沒有在其他簽核中的單據、保管人涵蓋每一列；全部簽核完成後自動更新財產清冊（保管人、地點、狀態）。
          </span>
        </span>
      </label>
      {link && (
        <div className="mt-3 space-y-2">
          <Field label="財產明細表">
            <select
              className={smallInput}
              value={link.table}
              onChange={(e) => {
                const t = tables.find((x) => x.id === e.target.value);
                update({
                  ...link,
                  table: e.target.value,
                  columns: {
                    asset: t ? pickColumn(t, 'asset') : '',
                    reason: t ? pickColumn(t, 'select') : '',
                    newCustodian: t ? pickColumn(t, 'employee') : '',
                    newLocation: t ? pickColumn(t, 'text') : '',
                  },
                });
              }}
            >
              <option value="">選擇明細表</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {table &&
            COLUMN_SLOTS.map((slot) => (
              <Field key={slot.key} label={slot.label}>
                <select
                  className={smallInput}
                  value={link.columns[slot.key]}
                  onChange={(e) => update({ ...link, columns: { ...link.columns, [slot.key]: e.target.value } })}
                >
                  <option value="">選擇欄位</option>
                  {table.columns
                    .filter((c) => c.type === slot.type && !c.formula)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-td-muted">{slot.hint}</p>
              </Field>
            ))}
          {PEOPLE_SLOTS.map((slot) => (
            <Field key={slot.key} label={slot.label}>
              <select
                className={smallInput}
                value={link.custodians[slot.key] ?? ''}
                onChange={(e) =>
                  update({ ...link, custodians: { ...link.custodians, [slot.key]: slot.optional ? e.target.value || null : e.target.value } })
                }
              >
                <option value="">{slot.optional ? '（不使用）' : '選擇員工欄位'}</option>
                {employees.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}
