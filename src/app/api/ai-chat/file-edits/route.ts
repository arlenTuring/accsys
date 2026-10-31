import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { parseOperations, saveFileEdit, type EditKind } from '@/lib/ai-chat/file-edits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Saves a photo edit: operations plus the browser's two renders. The original is not touched. */
export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ ok: false, error: '請先登入' }, { status: 401 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: '無法讀取內容' }, { status: 400 });
  }
  const kind = String(form.get('kind') ?? '') as EditKind;
  const sourceId = String(form.get('sourceId') ?? '');
  const expected = String(form.get('expectedEditId') ?? '');
  const output = form.get('output');
  const analysis = form.get('analysis');
  let operations = null;
  try {
    operations = parseOperations(JSON.parse(String(form.get('operations') ?? 'null')));
  } catch {
    operations = null;
  }
  if ((kind !== 'staged' && kind !== 'draft_file') || !/^[0-9a-f-]{36}$/i.test(sourceId) || !operations || !(output instanceof File) || !(analysis instanceof File)) {
    return NextResponse.json({ ok: false, error: '編輯內容不完整' }, { status: 400 });
  }
  const result = await saveFileEdit({
    ownerEmployeeId: employee.id,
    kind,
    sourceId,
    expectedEditId: expected || null,
    operations,
    output: new Uint8Array(await output.arrayBuffer()),
    analysis: new Uint8Array(await analysis.arrayBuffer()),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 400 });
}
