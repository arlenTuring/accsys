import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasAnyPermission, ADMIN_NAV_PERMISSIONS } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export const dynamic = 'force-dynamic';

const TOC = [
  { id: 'menu', label: '系統管理選單' },
  { id: 'accounts', label: '帳號與權限' },
  { id: 'org', label: '組織與簽核' },
  { id: 'forms', label: '表單設計器' },
  { id: 'master', label: '主檔資料' },
] as const;

function Shot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-td-border bg-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- guide assets include SVG screenshots */}
      <img src={src} alt={alt} className="h-auto w-full bg-td-surface object-contain object-top" />
      {caption ? <figcaption className="border-t border-td-border px-3 py-2 text-xs text-td-muted">{caption}</figcaption> : null}
    </figure>
  );
}

function Rules({ title, items }: { title: string; items: string[] }) {
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3">
      <h3 className="text-sm font-semibold text-td-blue-dark">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}

function Section({
  id,
  title,
  href,
  children,
}: {
  id: string;
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4 border-t border-td-border pt-8 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-td-blue-dark">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-semibold text-td-blue underline">
            開啟此功能 →
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default async function AdminGuidePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/guide');
  if (!hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS)) redirect('/dashboard');

  return (
    <main className="page-shell max-w-5xl space-y-8">
      <header>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">系統操作教學</h1>
        <p className="page-subtitle">以實際畫面說明系統管理操作；詳細規則集中在本頁，各功能頁只保留簡短提示。</p>
      </header>

      <nav aria-label="教學目錄" className="flex flex-wrap gap-2 rounded-lg border border-td-border bg-white p-3">
        {TOC.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-md border border-td-border px-3 py-1.5 text-sm font-semibold text-td-blue-dark hover:bg-td-blue-light"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <Section id="menu" title="系統管理選單">
        <p className="text-sm text-td-muted">頂部導覽 →「系統管理」展開後可進入各功能。</p>
        <Shot src="/admin-guide/01-admin-menu.svg" alt="系統管理下拉選單" caption="系統管理選單項目" />
      </Section>

      <Section id="accounts" title="帳號與權限" href="/admin/accounts">
        <div className="grid gap-4 lg:grid-cols-2">
          <Shot src="/admin-guide/02-accounts-binding.png" alt="帳號綁定" caption="帳號綁定：核准 Google、指派角色、停用" />
          <Shot src="/admin-guide/03-access-roles.png" alt="權限角色" caption="權限角色：清單摘要，展開看細節；右上新增" />
        </div>
        <Rules
          title="規則"
          items={[
            '帳號操作需 15 分鐘內登入過；權限角色需 1 小時內登入過，皆寫入稽核。',
            '員工資料已有相同公司信箱時，首次 Google 登入會自動綁定；否則進待核准。',
            '內建 staff／finance／admin 不可刪除；admin 權限固定為全部。',
            '自訂角色可修改或刪除（軟停用）；有人使用時須先改派。',
          ]}
        />
      </Section>

      <Section id="org" title="組織與簽核" href="/admin/org">
        <Shot src="/admin-guide/04-org-tabs.png" alt="組織與簽核分頁" caption="部門、員工、層級、職務、群組、代理人、模擬、人員同步" />
        <Rules
          title="規則"
          items={[
            '修改需 1 小時內登入過，並記錄稽核。',
            '簽核流程正在使用的部門／層級／職務／群組不可刪除或停用。',
            '權限角色不在此處，請到「帳號與權限」。',
          ]}
        />
      </Section>

      <Section id="forms" title="表單設計器" href="/admin/form-builder">
        <Shot src="/admin-guide/05-form-builder.png" alt="表單設計器列表" caption="新增、複製、暫停／發佈、刪除" />
        <Rules
          title="規則"
          items={[
            '發佈後出現在「申請表單」；每次發佈產生新版本。',
            '已送出的單據永遠依送出當時版本顯示與簽核。',
            '暫停：選單隱藏、不能新填，既有單據照常簽核。',
            '刪除：需「刪除表單」權限；已送出單據保留。',
            '複製：建立內容相同的草稿。修改需 1 小時內登入過。',
          ]}
        />
      </Section>

      <Section id="master" title="主檔資料" href="/admin/master-data">
        <Shot src="/admin-guide/06-master-data.png" alt="主檔資料" caption="部門、員工、預算、供應商總覽" />
        <p className="text-sm text-td-muted">此頁為唯讀總覽；日常維護以組織設定、帳號與權限為主。</p>
      </Section>
    </main>
  );
}
