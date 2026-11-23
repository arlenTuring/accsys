import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ensureEmployeeBudgetTasksAndHistory } from '@/lib/budget-codes/seed-budget-demo';
import { getCloneableSubmissionData, getNewFormContext } from '@/lib/custom-forms/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { CustomForm } from '../../custom-form';

export default async function NewDesignerFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{
    source?: string | string[];
    draft?: string | string[];
    copyFrom?: string | string[];
    assetId?: string | string[];
    assetIds?: string | string[];
    newLocation?: string | string[];
    remark?: string | string[];
    newCustodianId?: string | string[];
    year?: string | string[];
    scope?: string | string[];
  }>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const source = typeof sp.source === 'string' ? sp.source : undefined;
  const draftId = typeof sp.draft === 'string' ? sp.draft : undefined;
  const copyFrom = typeof sp.copyFrom === 'string' ? sp.copyFrom : undefined;
  const assetIdParam = typeof sp.assetId === 'string' ? sp.assetId : undefined;
  const assetIdsParam = typeof sp.assetIds === 'string' ? sp.assetIds : undefined;
  const newLocationParam = typeof sp.newLocation === 'string' ? sp.newLocation : undefined;
  const remarkParam = typeof sp.remark === 'string' ? sp.remark : undefined;
  const newCustodianIdParam = typeof sp.newCustodianId === 'string' ? sp.newCustodianId : undefined;

  const employee = await getCurrentEmployee();
  if (!employee) redirect(`/login?returnTo=/f/${encodeURIComponent(key)}/new`);
  if (key === 'budget-request') {
    await ensureEmployeeBudgetTasksAndHistory(employee);
  }
  const ctx = await getNewFormContext(key);
  if (!ctx) notFound();

  const fyParam = typeof sp.year === 'string' && sp.year.trim() ? sp.year.trim() : '116';
  const scopeParam = sp.scope === 'project' ? 'project' : sp.scope === 'department' ? 'department' : undefined;

  const matchedDraft = draftId
    ? ctx.savedDrafts.find((d) => d.id === draftId)
    : !copyFrom && !source && !assetIdParam && !assetIdsParam && ctx.savedDrafts.length > 0
      ? key === 'budget-request' && scopeParam
        ? ctx.savedDrafts.find((d) => {
            const dData = (d.data ?? {}) as Record<string, unknown>;
            const dScope = dData.budgetScope === 'project' ? 'project' : 'department';
            const dFy = String(dData.fiscalYear ?? '116');
            return dScope === scopeParam && dFy === fyParam;
          })
        : ctx.savedDrafts[0]
      : undefined;
  const cloned = !matchedDraft && copyFrom ? await getCloneableSubmissionData(key, copyFrom) : null;

  // Support pre-filling budget-request with Finance-dispatched account subjects & locking header info
  let budgetPrefill: Record<string, unknown> | undefined;
  let normalizedBudgetDraftData: Record<string, unknown> | undefined;
  if (key === 'budget-request') {
    const draftRaw = (matchedDraft?.data ?? {}) as Record<string, unknown>;
    const effectiveScope =
      scopeParam ??
      (draftRaw.budgetScope === 'project' ? 'project' : 'department');
    const effectiveFy = String(draftRaw.fiscalYear || fyParam || '116');
    const myDept = ctx.options.departments.find((d) => d.id === employee.departmentId);
    const deptCode = myDept?.code || 'DEPT';
    const firstProj = ctx.options.projects[0];
    const projCode = firstProj?.code || 'PROJ';
    const unitCode = effectiveScope === 'project' ? projCode : deptCode;

    if (matchedDraft) {
      normalizedBudgetDraftData = {
        ...draftRaw,
        fiscalYear: effectiveFy,
        budgetScope: effectiveScope,
        targetDepartmentId:
          typeof draftRaw.targetDepartmentId === 'string' && draftRaw.targetDepartmentId
            ? draftRaw.targetDepartmentId
            : employee.departmentId,
        ...(effectiveScope === 'project' && firstProj
          ? {
              targetProjectId:
                typeof draftRaw.targetProjectId === 'string' && draftRaw.targetProjectId
                  ? draftRaw.targetProjectId
                  : firstProj.id,
            }
          : {}),
        ownerEmployeeId: employee.id,
      };
    } else if (!cloned) {
      const dispatchedRows =
        effectiveScope === 'project'
          ? [
              {
                code: `${effectiveFy}${unitCode}PR01`,
                category: '專案營收',
                itemCode: 'PR01',
                accountNumber: '40000101',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '3600000',
                prevActualAmount: '3520000',
                description: '營收專案預計認列之合約／產品專案收入',
              },
              {
                code: `${effectiveFy}${unitCode}SE15`,
                category: '勞務費',
                itemCode: 'SE15',
                accountNumber: '69002101',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '720000',
                prevActualAmount: '695000',
                description: '專案外包技術顧問、點雲標註與測試驗證服務費',
              },
              {
                code: `${effectiveFy}${unitCode}SE17`,
                category: '雜項購置',
                itemCode: 'SE17',
                accountNumber: '69002201',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '480000',
                prevActualAmount: '460000',
                description: '專案車載測試耗材、零組件與小型工具購置',
              },
              {
                code: `${effectiveFy}${unitCode}SE03`,
                category: '旅費',
                itemCode: 'SE03',
                accountNumber: '69000501',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '360000',
                prevActualAmount: '345000',
                description: '專案場域駐點調試與客戶驗收期間工程師差旅費',
              },
            ]
          : [
              {
                code: `${effectiveFy}${unitCode}SE23`,
                category: '資訊服務費',
                itemCode: 'SE23',
                accountNumber: '69002301',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '960000',
                prevActualAmount: '920000',
                description: '雲端系統、軟體訂閱、網域名稱、AI 與資訊服務費',
              },
              {
                code: `${effectiveFy}${unitCode}SE03`,
                category: '旅費',
                itemCode: 'SE03',
                accountNumber: '69000501',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '360000',
                prevActualAmount: '385000',
                description: '國內外差旅交通、住宿、出差膳食補助等',
              },
              {
                code: `${effectiveFy}${unitCode}SE17`,
                category: '雜項購置',
                itemCode: 'SE17',
                accountNumber: '69002201',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '480000',
                prevActualAmount: '465000',
                description: '未達資本化門檻之小型設備、零組件、工具及軟體購置',
              },
              {
                code: `${effectiveFy}${unitCode}SE14`,
                category: '訓練費',
                itemCode: 'SE14',
                accountNumber: '69002001',
                rowOrigin: 'finance_dispatch',
                prevApprovedBudget: '120000',
                prevActualAmount: '115000',
                description: '員工內外部教育訓練、專業證照課程及研討會報名費',
              },
            ];

      budgetPrefill = {
        fiscalYear: effectiveFy,
        budgetScope: effectiveScope,
        targetDepartmentId: employee.departmentId,
        ...(effectiveScope === 'project' && firstProj ? { targetProjectId: firstProj.id } : {}),
        ownerEmployeeId: employee.id,
        items: {
          rows: dispatchedRows,
          total: 0,
        },
      };
    }
  }

  // Support pre-filling from「我的資產管理」when assetId / assetIds query params are passed
  let assetPrefill: Record<string, unknown> | undefined;
  let prefilledAssetSummary: string[] = [];
  if (!matchedDraft && !cloned && ctx.schema.assetRegister && (assetIdParam || assetIdsParam)) {
    const requestedIds = [
      ...(assetIdParam ? [assetIdParam] : []),
      ...(assetIdsParam ? assetIdsParam.split(',').map((s) => s.trim()).filter(Boolean) : []),
    ];
    const uniqueIds = [...new Set(requestedIds)];
    const matchedAssets = uniqueIds
      .map((id) => ctx.options.assets.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    if (matchedAssets.length > 0) {
      const link = ctx.schema.assetRegister;
      prefilledAssetSummary = matchedAssets.map((a) => a.label);
      assetPrefill = {
        useDepartmentId: employee.departmentId,
        transferTypes: ['custodian'],
        ...(remarkParam ? { remark: remarkParam } : {}),
        [link.custodians.original]: matchedAssets[0]?.custodianId ?? ctx.currentEmployeeId,
        ...(newCustodianIdParam ? { [link.custodians.new]: newCustodianIdParam } : {}),
        [link.table]: {
          rows: matchedAssets.map((a) => ({
            [link.columns.asset]: a.id,
            ...(link.columns.reason ? { [link.columns.reason]: 'custodian' } : {}),
            [link.columns.newCustodian]: newCustodianIdParam ?? '',
            [link.columns.newLocation]: newLocationParam ?? a.location ?? '',
          })),
          total: null,
        },
      };
    }
  }

  return (
    <main className="page-shell space-y-4">
      {prefilledAssetSummary.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
          <div>
            ✅ 已從「<strong>我的資產管理</strong>」自動帶入{' '}
            <strong>{prefilledAssetSummary.join('、')}</strong>{' '}
            之保管資料與目前位置，請選擇「新保管人」與「使用專案/客戶名稱」並上傳照片後即可送出。
          </div>
          <Link
            href="/assets/mine"
            className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1 font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            ← 返回我的資產管理
          </Link>
        </div>
      )}
      <CustomForm
        formKey={ctx.key}
        name={ctx.name}
        description={ctx.description}
        schema={ctx.schema}
        options={ctx.options}
        today={taipeiToday()}
        mode={{ kind: 'create' }}
        currentEmployeeId={ctx.currentEmployeeId}
        presetSource={source}
        filingScope={ctx.filingScope}
        savedDrafts={ctx.savedDrafts}
        initial={normalizedBudgetDraftData ?? matchedDraft?.data ?? cloned?.data ?? assetPrefill ?? budgetPrefill}
        initialDraftId={matchedDraft?.id ?? null}
        initialApplicantId={
          key === 'budget-request'
            ? employee.id
            : (matchedDraft?.applicantEmployeeId ?? cloned?.applicantEmployeeId ?? null)
        }
        clonedFromFormNumber={cloned?.sourceFormNumber ?? null}
        skipDraftRestore={Boolean(assetPrefill || budgetPrefill || cloned || source || key === 'budget-request')}
      />
    </main>
  );
}
