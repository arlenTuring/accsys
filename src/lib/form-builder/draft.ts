import { APPROVER_SOURCE_KINDS } from '@/lib/approval/flow/types';
import { FIELD_TYPES } from '@/lib/custom-forms/schema';

/**
 * Drafts may be incomplete (the full parsers run on publish), but they are
 * loaded back into the designer, so the shape it walks must hold: lists are
 * lists, ids and labels are strings, kinds are known. Client-safe.
 */

export const MAX_DRAFT_BYTES = 512 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === 'string';

function schemaProblem(raw: unknown): string | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.sections)) return '表單欄位格式不正確';
  for (const s of raw.sections) {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.title) || !isStr(s.description) || !Array.isArray(s.fields)) return '區段格式不正確';
    for (const f of s.fields) {
      if (!isObj(f) || !isStr(f.id) || !isStr(f.label) || !(FIELD_TYPES as readonly unknown[]).includes(f.type)) return '欄位格式不正確';
      if ((f.type === 'select' || f.type === 'radio' || f.type === 'checkboxes') && !Array.isArray(f.options)) return '選項格式不正確';
      if (f.type === 'table' && (!Array.isArray(f.columns) || !f.columns.every((c) => isObj(c) && isStr(c.id) && isStr(c.label)))) return '明細表格式不正確';
      if (f.visibleWhen !== undefined && !isObj(f.visibleWhen)) return '顯示條件格式不正確';
    }
  }
  return null;
}

function blocksProblem(v: unknown, depth: number): string | null {
  if (!Array.isArray(v) || depth > 12) return '關卡格式不正確';
  for (const b of v) {
    if (!isObj(b) || !isStr(b.id) || !isStr(b.label)) return '關卡格式不正確';
    if (b.type === 'approver') {
      if (!isObj(b.source) || !(APPROVER_SOURCE_KINDS as readonly unknown[]).includes(b.source.kind)) return '簽核人格式不正確';
      if (b.source.kind === 'org_chain' && !Array.isArray(b.source.rules)) return '組織層級規則格式不正確';
    } else if (b.type === 'condition') {
      if (!Array.isArray(b.branches) || !isObj(b.otherwise) || !isStr(b.otherwise.label)) return '條件式格式不正確';
      for (const br of b.branches) {
        if (!isObj(br) || !isStr(br.id) || !isStr(br.label) || !isObj(br.when)) return '條件式格式不正確';
        const p = blocksProblem(br.blocks, depth + 1);
        if (p) return p;
      }
      const p = blocksProblem(b.otherwise.blocks, depth + 1);
      if (p) return p;
    } else {
      return '關卡格式不正確';
    }
  }
  return null;
}

function flowProblem(raw: unknown): string | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.options)) return '簽核流程格式不正確';
  return blocksProblem(raw.blocks, 0);
}

/** null when the draft can be stored; otherwise why not. */
export function draftProblem(schema: unknown, flow: unknown): string | null {
  const size = new TextEncoder().encode(JSON.stringify({ schema, flow })).length;
  if (size > MAX_DRAFT_BYTES) return '表單內容過大，請減少欄位或選項';
  return schemaProblem(schema) ?? flowProblem(flow);
}
