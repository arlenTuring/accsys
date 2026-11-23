import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import type { ProjectKind } from '@/lib/expense-claims/editions';
import { HISTORICAL_YEAR_GROUPS } from '@/lib/projects/historical-projects-data';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
  kind: ProjectKind;
  created_at?: string;
  /** 西元年度（例如 2026、2025、2024…） */
  year?: number;
  /** 民國年度（例如 115、114、113…） */
  rocYear?: number;
  /** 負責部門或執行期間說明 */
  department?: string;
  period?: string;
  /** 是否來自歷年專案知識庫／歷史清單 */
  isHistorical?: boolean;
  /** 是否啟用中（預設 true；若已停用則為 false） */
  active?: boolean;
  /** 此專案已建立的預算科目代號筆數（budget_codes.project_id） */
  budgetCodeCount?: number;
  /** 此專案關聯的預算申請單／變更單／草稿或費用請購單據筆數 */
  budgetFormCount?: number;
  /** 是否已經有使用到（已建立預算單、預算科目或費用單據）；為 true 時不可刪除、僅可停用 */
  hasBudgetForms?: boolean;
};

type HistoricalProjectMeta = {
  code: string;
  name: string;
  kind: ProjectKind;
  year: number;
  department: string;
  period: string;
  isoCreatedAt: string;
};

const HISTORICAL_PROJECT_META_MAP: Map<string, HistoricalProjectMeta> = (() => {
  const map = new Map<string, HistoricalProjectMeta>();
  for (const group of HISTORICAL_YEAR_GROUPS) {
    group.projects.forEach((p, idx) => {
      const code = p.code.trim();
      const deptLower = `${p.department} ${p.name}`.toLowerCase();
      const isProduct =
        deptLower.includes('r&d') ||
        deptLower.includes('核心平台') ||
        deptLower.includes('產品開發') ||
        deptLower.includes('自研') ||
        code.startsWith('RD-') ||
        code.startsWith('PROD-') ||
        code === 'PJ-389';
      const kind: ProjectKind = isProduct ? 'product' : 'revenue';

      // Extract exact date if name starts with YYYYMMDD, otherwise use year + month offset
      const ymdMatch = p.name.match(/^(\d{4})(\d{2})(\d{2})/);
      const year = ymdMatch ? Number(ymdMatch[1]) : p.startYear || group.year;
      const month = ymdMatch ? ymdMatch[2] : String(Math.max(1, 9 - idx)).padStart(2, '0');
      const day = ymdMatch ? ymdMatch[3] : '15';
      const isoCreatedAt = `${year}-${month}-${day}T08:00:00.000Z`;

      map.set(code.toUpperCase(), {
        code,
        name: p.name,
        kind,
        year,
        department: p.department,
        period: p.period,
        isoCreatedAt,
      });
    });
  }
  return map;
})();

export function inferProjectWestYear(code: string, name?: string, createdAt?: string): number {
  const upper = code.trim().toUpperCase();
  const hist = HISTORICAL_PROJECT_META_MAP.get(upper);
  if (hist) return hist.year;

  // 1. 民國 3 碼開頭（例如 116BD001 -> 2027, 115GO001 -> 2026, 114BD014 -> 2025, 113BD005 -> 2024, 112BD003 -> 2023）
  const roc3 = upper.match(/^(1[01]\d)/);
  if (roc3) return Number(roc3[1]) + 1911;

  // 2. TD26 / RV26 等 2 碼西元簡寫（例如 TD2601 -> 2026, RV2601 -> 2026）
  const prefix2 = upper.match(/^(?:TD|RV)(\d{2})\d+/);
  if (prefix2) return 2000 + Number(prefix2[1]);

  // 3. 代碼或名稱內含 2018~2030 西元年（例如 T3-2026, GF-2025, 2024_GOLFACE, 20190719）
  const westInCode = upper.match(/(20[12]\d)/);
  if (westInCode) return Number(westInCode[1]);
  if (name) {
    const westInName = name.match(/(20[12]\d)/);
    if (westInName) return Number(westInName[1]);
  }

  // 4. 特殊已知專案代碼
  if (upper === 'YW20' || upper === 'T09') return 2025;

  // 5. Fallback to createdAt year or current year
  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) return d.getFullYear();
  }
  return 2026;
}

export function sortProjectsNewestFirst(items: ProjectListItem[]): ProjectListItem[] {
  return [...items].sort((a, b) => {
    const yA = a.year ?? inferProjectWestYear(a.code, a.name, a.created_at);
    const yB = b.year ?? inferProjectWestYear(b.code, b.name, b.created_at);
    if (yA !== yB) {
      return yB - yA; // 最新年度排在最前面，舊年度排在後面
    }
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tA && tB && Math.abs(tA - tB) > 10_000) {
      return tB - tA;
    }
    return b.code.localeCompare(a.code, 'zh-Hant-TW', { numeric: true });
  });
}

let historicalSeededDone = false;
let historicalSeedPromise: Promise<void> | null = null;

/**
 * 將歷年專案知識庫（2019～2026）自動同步補齊至 projects 主檔清單中，
 * 若某歷史專案曾被使用者手動刪除（紀錄於 audit_events 的 project.deleted），則不再重新匯入。
 */
async function ensureHistoricalProjectsInDb(): Promise<void> {
  if (historicalSeededDone) return;
  if (historicalSeedPromise) return historicalSeedPromise;
  historicalSeedPromise = (async () => {
    try {
      const db = getDb();
      const supabase = createAppDb();

      const [{ data: existingRows }, deletedRows] = await Promise.all([
        supabase.from('projects').select('code'),
        db.execute<{ code: string }>(sql`
          select distinct coalesce(details->'before'->>'code', details->>'code') as code
          from audit_events
          where entity_type = 'project'
            and action = 'project.deleted'
        `),
      ]);

      const existingCodes = new Set(
        (existingRows ?? []).map((r) => String(r.code ?? '').trim().toUpperCase())
      );
      const deletedCodes = new Set(
        deletedRows
          .map((r) => String(r.code ?? '').trim().toUpperCase())
          .filter(Boolean)
      );

      for (const meta of HISTORICAL_PROJECT_META_MAP.values()) {
        const upper = meta.code.toUpperCase();
        if (existingCodes.has(upper) || deletedCodes.has(upper)) continue;

        await supabase.from('projects').upsert(
          {
            code: meta.code,
            name: meta.name,
            kind: meta.kind,
            created_at: meta.isoCreatedAt,
          },
          { onConflict: 'code' }
        );
      }
      historicalSeededDone = true;
    } catch {
      // Non-fatal in restricted test environments
    } finally {
      historicalSeedPromise = null;
    }
  })();
  return historicalSeedPromise;
}

export async function getProjectList(opts?: {
  includeInactive?: boolean;
}): Promise<ProjectListItem[]> {
  await ensureHistoricalProjectsInDb();

  const includeInactive = opts?.includeInactive ?? true;
  const supabase = createAppDb();
  const { data } = await supabase
    .from('projects')
    .select('id, code, name, kind, created_at')
    .order('created_at', { ascending: false })
    .order('code', { ascending: false });

  const rawList = (data ?? []) as ProjectListItem[];
  if (rawList.length === 0) return [];

  const activeByProjectId = new Map<string, boolean>();
  const budgetCodeCountByProjectId = new Map<string, number>();
  const budgetFormCountByProjectId = new Map<string, number>();

  try {
    const db = getDb();
    const [statusRows, bcRows, formRows] = await Promise.all([
      db.execute<{ entity_id: string; action: string }>(sql`
        select distinct on (entity_id)
          entity_id,
          action
        from audit_events
        where entity_type = 'project'
          and entity_id is not null
          and action in ('project.disabled', 'project.enabled')
        order by entity_id, occurred_at desc, id desc
      `),
      db.execute<{ project_id: string; cnt: number }>(sql`
        select
          project_id::text as project_id,
          count(*)::int as cnt
        from budget_codes
        where project_id is not null
        group by project_id
      `),
      db.execute<{ project_id: string; cnt: number }>(sql`
        select
          p.id::text as project_id,
          (
            (select count(*)::int from form_submissions fs
             where fs.project_id = p.id
                or fs.data->>'projectCode' = p.code
                or fs.budget_code_id in (select bc.id from budget_codes bc where bc.project_id = p.id))
            +
            (select count(*)::int from form_drafts fd
             where fd.data->>'projectCode' = p.code)
            +
            (select count(*)::int from purchase_request_items pri
             where pri.budget_code_id in (select bc.id from budget_codes bc where bc.project_id = p.id))
            +
            (select count(*)::int from project_expenses pe
             where pe.budget_code_id in (select bc.id from budget_codes bc where bc.project_id = p.id))
            +
            (select count(*)::int from revenue_expenses re
             where re.budget_code_id in (select bc.id from budget_codes bc where bc.project_id = p.id))
            +
            (select count(*)::int from asset_transfers at2
             where at2.use_budget_code_id in (select bc.id from budget_codes bc where bc.project_id = p.id))
          )::int as cnt
        from projects p
      `),
    ]);

    for (const r of statusRows) {
      if (r.entity_id) {
        activeByProjectId.set(r.entity_id, r.action !== 'project.disabled');
      }
    }
    for (const r of bcRows) {
      budgetCodeCountByProjectId.set(r.project_id, Number(r.cnt) || 0);
    }
    for (const r of formRows) {
      budgetFormCountByProjectId.set(r.project_id, Number(r.cnt) || 0);
    }
  } catch {
    // Fallback gracefully if extra stats query fails
  }

  const enriched: ProjectListItem[] = rawList.map((item) => {
    const upper = item.code.trim().toUpperCase();
    const histMeta = HISTORICAL_PROJECT_META_MAP.get(upper);
    const westYear = inferProjectWestYear(item.code, item.name, item.created_at);
    const rocYear = westYear - 1911;
    const active = activeByProjectId.get(item.id) ?? true;
    const budgetCodeCount = budgetCodeCountByProjectId.get(item.id) ?? 0;
    const budgetFormCount = budgetFormCountByProjectId.get(item.id) ?? 0;
    const hasBudgetForms = budgetCodeCount > 0 || budgetFormCount > 0;

    return {
      ...item,
      year: westYear,
      rocYear,
      department: histMeta?.department,
      period: histMeta?.period ?? `${rocYear} 年度（${westYear}）`,
      isHistorical: Boolean(histMeta) || westYear <= 2025,
      active,
      budgetCodeCount,
      budgetFormCount,
      hasBudgetForms,
    };
  });

  const filtered = includeInactive
    ? enriched
    : enriched.filter((item) => item.active !== false);

  return sortProjectsNewestFirst(filtered);
}
