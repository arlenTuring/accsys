import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { createAppDb } from '@/lib/db/app-client';
import {
  generateBudgetExcelTemplate,
  type BudgetTemplateType,
  type TemplateDepartmentUnit,
  type TemplateProjectUnit,
} from '@/lib/budget-codes/templates';

const VALID_TYPES = new Set<BudgetTemplateType>(['flat', 'department', 'project', 'variance']);

export async function GET(
  request: Request,
  context: { params: Promise<{ type: string }> }
) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const { type } = await context.params;
  const templateType: BudgetTemplateType = VALID_TYPES.has(type as BudgetTemplateType)
    ? (type as BudgetTemplateType)
    : 'flat';

  const url = new URL(request.url);
  const fiscalYear = url.searchParams.get('year') ?? '2027';

  let departments: TemplateDepartmentUnit[] | undefined;
  let projects: TemplateProjectUnit[] | undefined;

  try {
    const db = createAppDb();
    const [deptRes, projRes] = await Promise.all([
      db.from('departments').select('code, name').eq('active', true).order('code'),
      db.from('projects').select('code, name, kind').order('code'),
    ]);
    if (deptRes.data && deptRes.data.length > 0) {
      departments = deptRes.data.map((d) => ({ code: d.code, name: `${d.name}(${d.code})` }));
    }
    if (projRes.data && projRes.data.length > 0) {
      projects = projRes.data.map((p) => ({
        code: p.code,
        name: p.name,
        kind: p.kind === 'revenue' ? 'revenue' : 'product',
      }));
    }
  } catch {
    // Use default units if DB is unavailable
  }

  const { buffer, filename } = await generateBudgetExcelTemplate({
    type: templateType,
    fiscalYear,
    departments,
    projects,
  });

  const encodedName = encodeURIComponent(filename);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="budget-template.xlsx"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'no-store',
    },
  });
}
