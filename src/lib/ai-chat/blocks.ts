/**
 * Controlled interactive message blocks. Gemini may propose block kinds +
 * payloads; the server validates and stores them. The client only renders
 * known components — never model-authored HTML/JS/React.
 */

export const AI_BLOCK_KINDS = [
  'text',
  'choice',
  'project_picker',
  'field_question',
  'attachment_status',
  'document_summary',
  'draft_reference',
  'action_result',
  'nudge_confirm',
  'document_picker',
  'approved_pdf_card',
  'field_form',
  'change_confirm',
] as const;

/** One input of a field_form card; built by the server from the form schema, never by the model. */
export type FormCardField = {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'datetime' | 'money' | 'number' | 'select' | 'employee' | 'project';
  required: boolean;
  /** select / employee choices (value = option value or employee id). */
  options?: { value: string; label: string }[];
  /** Value stored in the draft when the card was made. */
  current?: string;
};

export type CardStatus = 'open' | 'answered' | 'expired';

export type AiBlockKind = (typeof AI_BLOCK_KINDS)[number];

export type ChoiceOption = {
  id: string;
  label: string;
  /** Opaque value bound server-side (e.g. form key, field value). */
  value: string;
};

export type AiMessageBlock =
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'choice';
      id: string;
      prompt: string;
      options: ChoiceOption[];
      draftId?: string;
      draftVersion?: number;
      conversationId: string;
      /** Once answered or superseded. */
      status: 'open' | 'answered' | 'expired';
      selectedOptionId?: string;
    }
  | {
      kind: 'project_picker';
      id: string;
      prompt: string;
      draftId?: string;
      draftVersion?: number;
      conversationId: string;
      fieldId?: string;
      status: 'open' | 'answered' | 'expired';
      selectedProjectId?: string;
      selectedLabel?: string;
    }
  | {
      kind: 'field_question';
      id: string;
      prompt: string;
      fieldId: string;
      draftId: string;
      draftVersion: number;
      conversationId: string;
      inputType: 'text' | 'number' | 'date';
      status: 'open' | 'answered' | 'expired';
      answeredValue?: string;
    }
  | {
      kind: 'attachment_status';
      id: string;
      fileName: string;
      state: 'scanning' | 'ready' | 'rejected' | 'duplicate_hint';
      detail?: string;
    }
  | {
      kind: 'document_summary';
      id: string;
      title: string;
      fields: Array<{ label: string; value: string; source: 'user' | 'image' | 'system' | 'inferred' }>;
    }
  | {
      kind: 'draft_reference';
      id: string;
      draftId: string;
      formKey: string;
      formName: string;
      version: number;
      status: string;
    }
  | {
      kind: 'field_form';
      id: string;
      prompt: string;
      conversationId: string;
      draftId: string;
      draftVersion: number;
      formName: string;
      fields: FormCardField[];
      status: CardStatus;
      /** Receipt after it was used (what the database stored). */
      outcome?: string;
    }
  | {
      kind: 'change_confirm';
      id: string;
      prompt: string;
      conversationId: string;
      draftId: string;
      draftVersion: number;
      formName: string;
      /** value = what will be written (as the assistant tools accept it); from / to are for display. */
      changes: { field: string; label: string; from: string; to: string; value: string }[];
      status: CardStatus;
      outcome?: string;
    }
  | {
      kind: 'action_result';
      id: string;
      action: string;
      ok: boolean;
      message: string;
      formNumber?: string;
      href?: string;
    }
  | {
      kind: 'nudge_confirm';
      id: string;
      formType: string;
      formId: string;
      caseNumber: string;
      recipientNames: string[];
      status: 'open' | 'queued' | 'notified' | 'failed' | 'already_today' | 'expired';
      conversationId: string;
    }
  | {
      kind: 'document_picker';
      id: string;
      prompt: string;
      conversationId: string;
      /** Target draft when attaching; omit if user must choose. */
      targetDraftId?: string;
      targetDraftVersion?: number;
      status: 'open' | 'answered' | 'expired';
      items: Array<{
        formType: string;
        formId: string;
        formKey?: string;
        formNumber: string;
        formName: string;
        status: string;
        summary: string;
        approvedAt?: string;
      }>;
    }
  | {
      kind: 'approved_pdf_card';
      id: string;
      snapshotId: string;
      formNumber: string;
      fileName: string;
      contentHash: string;
      draftId?: string;
      previewHref: string;
    };

const KIND_SET = new Set<string>(AI_BLOCK_KINDS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function asUuid(v: unknown): string | null {
  const s = asString(v, 36);
  if (!s) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s;
}

/**
 * Same assistant turn may emit create (v1) + patch (v2) draft_reference blocks.
 * Keep one card per draftId (latest version); do not merge distinct draftIds.
 */
export function dedupeDraftReferenceBlocks(blocks: AiMessageBlock[]): AiMessageBlock[] {
  const latestByDraft = new Map<string, Extract<AiMessageBlock, { kind: 'draft_reference' }>>();
  for (const b of blocks) {
    if (b.kind !== 'draft_reference') continue;
    const prev = latestByDraft.get(b.draftId);
    if (!prev || b.version >= prev.version) {
      latestByDraft.set(b.draftId, b);
    }
  }
  if (latestByDraft.size === 0) return blocks;

  const placed = new Set<string>();
  const out: AiMessageBlock[] = [];
  for (const b of blocks) {
    if (b.kind !== 'draft_reference') {
      out.push(b);
      continue;
    }
    if (placed.has(b.draftId)) continue;
    const latest = latestByDraft.get(b.draftId)!;
    placed.add(b.draftId);
    out.push(latest);
  }
  return out;
}

/** Validate and normalize blocks from tool output or stored JSON. Drops invalid entries. */
export function sanitizeBlocks(raw: unknown, conversationId: string): AiMessageBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: AiMessageBlock[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = asString(item.kind, 40);
    const id = asString(item.id, 64) ?? cryptoRandomId();
    if (!kind || !KIND_SET.has(kind)) continue;

    switch (kind as AiBlockKind) {
      case 'text': {
        const text = asString(item.text, 4000);
        if (text) out.push({ kind: 'text', id, text });
        break;
      }
      case 'choice': {
        const prompt = asString(item.prompt, 500);
        if (!prompt || !Array.isArray(item.options)) break;
        const options: ChoiceOption[] = [];
        for (const o of item.options.slice(0, 20)) {
          if (!isRecord(o)) continue;
          const oid = asString(o.id, 64);
          const label = asString(o.label, 120);
          const value = asString(o.value, 200);
          if (oid && label && value) options.push({ id: oid, label, value });
        }
        if (options.length === 0) break;
        out.push({
          kind: 'choice',
          id,
          prompt,
          options,
          draftId: asUuid(item.draftId) ?? undefined,
          draftVersion: typeof item.draftVersion === 'number' ? item.draftVersion : undefined,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          selectedOptionId: asString(item.selectedOptionId, 64) ?? undefined,
        });
        break;
      }
      case 'project_picker': {
        const prompt = asString(item.prompt, 500) ?? '請選擇專案';
        out.push({
          kind: 'project_picker',
          id,
          prompt,
          draftId: asUuid(item.draftId) ?? undefined,
          draftVersion: typeof item.draftVersion === 'number' ? item.draftVersion : undefined,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          fieldId: asString(item.fieldId, 80) ?? undefined,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          selectedProjectId: asUuid(item.selectedProjectId) ?? undefined,
          selectedLabel: asString(item.selectedLabel, 200) ?? undefined,
        });
        break;
      }
      case 'field_question': {
        const prompt = asString(item.prompt, 500);
        const fieldId = asString(item.fieldId, 80);
        const draftId = asUuid(item.draftId);
        const draftVersion = typeof item.draftVersion === 'number' ? item.draftVersion : null;
        if (!prompt || !fieldId || !draftId || draftVersion === null) break;
        const inputType =
          item.inputType === 'number' || item.inputType === 'date' ? item.inputType : 'text';
        out.push({
          kind: 'field_question',
          id,
          prompt,
          fieldId,
          draftId,
          draftVersion,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          inputType,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          answeredValue: asString(item.answeredValue, 500) ?? undefined,
        });
        break;
      }
      case 'field_form': {
        const prompt = asString(item.prompt, 500);
        const draftId = asUuid(item.draftId);
        const draftVersion = typeof item.draftVersion === 'number' ? item.draftVersion : null;
        const formName = asString(item.formName, 120) ?? '';
        if (!prompt || !draftId || draftVersion === null || !Array.isArray(item.fields)) break;
        const types = new Set<FormCardField['type']>(['text', 'textarea', 'date', 'datetime', 'money', 'number', 'select', 'employee', 'project']);
        const fields: FormCardField[] = [];
        for (const f of item.fields.slice(0, 12)) {
          if (!isRecord(f)) continue;
          const fid = asString(f.id, 80);
          const label = asString(f.label, 120);
          const type = asString(f.type, 20) as FormCardField['type'] | null;
          if (!fid || !label || !type || !types.has(type)) continue;
          const options = Array.isArray(f.options)
            ? f.options
                .slice(0, 300)
                .filter(isRecord)
                .map((o) => ({ value: asString(o.value, 120) ?? '', label: asString(o.label, 160) ?? '' }))
                .filter((o) => o.value && o.label)
            : undefined;
          fields.push({ id: fid, label, type, required: f.required === true, options, current: asString(f.current, 500) ?? undefined });
        }
        if (fields.length === 0) break;
        out.push({
          kind: 'field_form',
          id,
          prompt,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          draftId,
          draftVersion,
          formName,
          fields,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          outcome: asString(item.outcome, 1000) ?? undefined,
        });
        break;
      }
      case 'change_confirm': {
        const prompt = asString(item.prompt, 500);
        const draftId = asUuid(item.draftId);
        const draftVersion = typeof item.draftVersion === 'number' ? item.draftVersion : null;
        if (!prompt || !draftId || draftVersion === null || !Array.isArray(item.changes)) break;
        const changes = item.changes
          .slice(0, 30)
          .filter(isRecord)
          .map((c) => ({
            field: asString(c.field, 80) ?? '',
            label: asString(c.label, 120) ?? '',
            from: asString(c.from, 500) ?? '',
            to: asString(c.to, 500) ?? '',
            value: asString(c.value, 2000) ?? '',
          }))
          .filter((c) => c.field && c.label);
        if (changes.length === 0) break;
        out.push({
          kind: 'change_confirm',
          id,
          prompt,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          draftId,
          draftVersion,
          formName: asString(item.formName, 120) ?? '',
          changes,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          outcome: asString(item.outcome, 1000) ?? undefined,
        });
        break;
      }
      case 'attachment_status': {
        const fileName = asString(item.fileName, 200);
        if (!fileName) break;
        const state =
          item.state === 'ready' || item.state === 'rejected' || item.state === 'duplicate_hint'
            ? item.state
            : 'scanning';
        out.push({
          kind: 'attachment_status',
          id,
          fileName,
          state,
          detail: asString(item.detail, 500) ?? undefined,
        });
        break;
      }
      case 'document_summary': {
        const title = asString(item.title, 200);
        if (!title || !Array.isArray(item.fields)) break;
        const fields: Array<{
          label: string;
          value: string;
          source: 'user' | 'image' | 'system' | 'inferred';
        }> = [];
        for (const f of item.fields.slice(0, 40)) {
          if (!isRecord(f)) continue;
          const label = asString(f.label, 80);
          const value = asString(f.value, 500);
          const source =
            f.source === 'user' || f.source === 'image' || f.source === 'system' || f.source === 'inferred'
              ? f.source
              : 'inferred';
          if (label && value) fields.push({ label, value, source });
        }
        out.push({ kind: 'document_summary', id, title, fields });
        break;
      }
      case 'draft_reference': {
        const draftId = asUuid(item.draftId);
        const formKey = asString(item.formKey, 40);
        const formName = asString(item.formName, 120);
        const version = typeof item.version === 'number' ? item.version : null;
        const status = asString(item.status, 40);
        if (!draftId || !formKey || !formName || version === null || !status) break;
        out.push({ kind: 'draft_reference', id, draftId, formKey, formName, version, status });
        break;
      }
      case 'action_result': {
        const action = asString(item.action, 80);
        const message = asString(item.message, 1000);
        if (!action || !message || typeof item.ok !== 'boolean') break;
        out.push({
          kind: 'action_result',
          id,
          action,
          ok: item.ok,
          message,
          formNumber: asString(item.formNumber, 40) ?? undefined,
          href: asString(item.href, 200) ?? undefined,
        });
        break;
      }
      case 'nudge_confirm': {
        const formType = asString(item.formType, 40);
        const formId = asUuid(item.formId);
        const caseNumber = asString(item.caseNumber, 40);
        if (!formType || !formId || !caseNumber || !Array.isArray(item.recipientNames)) break;
        const recipientNames = item.recipientNames
          .map((n) => asString(n, 80))
          .filter((n): n is string => Boolean(n))
          .slice(0, 20);
        out.push({
          kind: 'nudge_confirm',
          id,
          formType,
          formId,
          caseNumber,
          recipientNames,
          status:
            item.status === 'queued' ||
            item.status === 'notified' ||
            item.status === 'failed' ||
            item.status === 'already_today' ||
            item.status === 'expired'
              ? item.status
              : 'open',
          conversationId: asUuid(item.conversationId) ?? conversationId,
        });
        break;
      }
      case 'document_picker': {
        const prompt = asString(item.prompt, 500) ?? '請選擇單據';
        if (!Array.isArray(item.items)) break;
        const items: Extract<AiMessageBlock, { kind: 'document_picker' }>['items'] = [];
        for (const raw of item.items.slice(0, 20)) {
          if (!isRecord(raw)) continue;
          const formType = asString(raw.formType, 40);
          const formId = asUuid(raw.formId);
          const formNumber = asString(raw.formNumber, 40);
          const formName = asString(raw.formName, 120);
          const status = asString(raw.status, 40);
          const summary = asString(raw.summary, 240);
          if (!formType || !formId || !formNumber || !formName || !status || !summary) continue;
          items.push({
            formType,
            formId,
            formKey: asString(raw.formKey, 40) ?? undefined,
            formNumber,
            formName,
            status,
            summary,
            approvedAt: asString(raw.approvedAt, 40) ?? undefined,
          });
        }
        out.push({
          kind: 'document_picker',
          id,
          prompt,
          conversationId: asUuid(item.conversationId) ?? conversationId,
          targetDraftId: asUuid(item.targetDraftId) ?? undefined,
          targetDraftVersion: typeof item.targetDraftVersion === 'number' ? item.targetDraftVersion : undefined,
          status: item.status === 'answered' || item.status === 'expired' ? item.status : 'open',
          items,
        });
        break;
      }
      case 'approved_pdf_card': {
        const snapshotId = asUuid(item.snapshotId);
        const formNumber = asString(item.formNumber, 40);
        const fileName = asString(item.fileName, 200);
        const contentHash = asString(item.contentHash, 64);
        const previewHref = asString(item.previewHref, 200);
        if (!snapshotId || !formNumber || !fileName || !contentHash || !previewHref) break;
        out.push({
          kind: 'approved_pdf_card',
          id,
          snapshotId,
          formNumber,
          fileName,
          contentHash,
          draftId: asUuid(item.draftId) ?? undefined,
          previewHref,
        });
        break;
      }
      default:
        break;
    }
  }
  return dedupeDraftReferenceBlocks(out).slice(0, 20);
}

function cryptoRandomId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
