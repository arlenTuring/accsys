import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasAnyPermission, ADMIN_NAV_PERMISSIONS } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export const dynamic = 'force-dynamic';

/**
 * System-admin how-to. Structure: chapter → topic → numbered steps + screenshots.
 * Each topic: purpose, entry path, numbered steps, real screenshots, short tips.
 */

type TocItem = { id: string; label: string };

const TOC: TocItem[] = [
  { id: 'menu', label: '系統管理選單' },
  { id: 'accounts-binding', label: '帳號綁定' },
  { id: 'accounts-roles', label: '權限角色' },
  { id: 'org-dept', label: '部門' },
  { id: 'org-employees', label: '員工' },
  { id: 'org-levels', label: '組織層級' },
  { id: 'org-job-roles', label: '職務類別' },
  { id: 'org-groups', label: '員工群組' },
  { id: 'org-delegations', label: '代理人' },
  { id: 'org-simulator', label: '流程模擬' },
  { id: 'org-directory', label: '人員同步' },
  { id: 'forms-list', label: '表單設計器・列表' },
  { id: 'forms-design', label: '表單設計器・編輯' },
  { id: 'master', label: '主檔資料' },
];

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

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-5 text-slate-700">
      {children}
    </aside>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-800">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

function Topic({
  id,
  title,
  href,
  purpose,
  children,
}: {
  id: string;
  title: string;
  href?: string;
  purpose: string;
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
      <p className="text-sm text-td-muted">{purpose}</p>
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
        <p className="page-subtitle">
          依系統管理各功能逐步說明怎麼操作。各管理頁只保留簡短提示；細節與畫面都在本頁。
        </p>
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

      <Topic
        id="menu"
        title="系統管理選單"
        purpose="從頂部導覽進入各管理功能。選單項目會依你的權限顯示，沒有權限的項目不會出現。"
      >
        <Steps
          items={[
            '登入後看頁面上方導覽列。',
            '點「系統管理」展開下拉選單。',
            '依需求點「帳號與權限」「組織與簽核」「表單設計器」「主檔資料」或本教學。',
          ]}
        />
        <Shot src="/admin-guide/01-admin-menu.svg" alt="系統管理下拉選單" caption="系統管理選單項目示意" />
      </Topic>

      <Topic
        id="accounts-binding"
        title="帳號綁定"
        href="/admin/accounts"
        purpose="處理員工 Google 帳號與員工主檔的對應：核准或拒絕綁定申請、調整權限角色、停用或重新啟用帳號。"
      >
        <p className="text-sm font-semibold text-td-blue-dark">進入方式</p>
        <Steps items={['頂部「系統管理」→「帳號與權限」→ 分頁「帳號綁定」。']} />
        <p className="text-sm font-semibold text-td-blue-dark">常見操作</p>
        <Steps
          items={[
            '查看「待核准」清單：員工已用 Google 登入但尚未對到主檔時會出現在這裡。',
            '核准：選擇對應員工後核准；拒絕：填原因後退回申請。',
            '在已綁定清單調整「權限角色」（一般／財會／管理員或自訂角色）。',
            '停用員工：無法再登入；啟用後可再次登入（仍須有效綁定）。',
          ]}
        />
        <Shot
          src="/admin-guide/07-accounts-binding.png"
          alt="帳號綁定畫面"
          caption="帳號綁定：待核准清單與員工帳號（可改角色、停用）"
        />
        <Tip>
          <p className="font-semibold text-td-blue-dark">注意</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>帳號相關操作需最近 15 分鐘內重新登入過，並會寫入稽核。</li>
            <li>
              若員工主檔已填相同公司信箱，首次 Google 登入可能自動綁定，不一定會進待核准。
            </li>
            <li>不能在此頁把「自己」的管理員身分拿掉到無法管理系統的程度（依畫面提示為準）。</li>
          </ul>
        </Tip>
      </Topic>

      <Topic
        id="accounts-roles"
        title="權限角色"
        href="/admin/accounts/roles"
        purpose="決定員工能進哪些管理／財會功能。與「職務類別」不同：職務類別只影響簽核與可填表單範圍。"
      >
        <p className="text-sm font-semibold text-td-blue-dark">進入方式</p>
        <Steps items={['「系統管理」→「帳號與權限」→ 分頁「權限角色」。']} />
        <p className="text-sm font-semibold text-td-blue-dark">常見操作</p>
        <Steps
          items={[
            '瀏覽角色清單：每列顯示權限摘要；點列可展開看細節。',
            '右上「新增角色」：命名並勾選權限後儲存。',
            '展開後可修改勾選項目並儲存，或刪除（軟停用）自訂角色。',
            '回到「帳號綁定」或「組織 → 員工」，把角色指派給員工。',
          ]}
        />
        <Shot src="/admin-guide/08-access-roles-list.png" alt="權限角色清單" caption="權限角色清單：展開看細節，右上新增" />
        <Shot src="/admin-guide/09-access-roles-create.png" alt="新增權限角色對話框" caption="新增角色：填代號／名稱並勾選權限後儲存" />
        <Tip>
          <p className="font-semibold text-td-blue-dark">注意</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>內建 staff／finance／admin 不可刪除；admin 權限固定為全部。</li>
            <li>有人正在使用的角色要刪除前，須先改派那些員工。</li>
            <li>修改權限角色需 1 小時內登入過。</li>
          </ul>
        </Tip>
      </Topic>

      <Topic
        id="org-dept"
        title="組織與簽核・部門"
        href="/admin/org"
        purpose="維護部門樹、上層部門、組織層級、部門主管與排序。簽核流程常依賴部門與主管。"
      >
        <Steps
          items={[
            '「系統管理」→「組織與簽核」→ 分頁「部門」。',
            '新增或編輯部門：名稱、上層、層級、主管等。',
            '可用拖拉調整部門上下層或同層排序（以畫面上的操作為準）。',
            '停用前先確認：在職員工與下層部門已處理，且沒有進行中流程卡住。',
          ]}
        />
        <Shot src="/admin-guide/10-org-departments.png" alt="部門設定" caption="部門：新增、編輯、拖拉調整上下層與排序" />
      </Topic>

      <Topic
        id="org-employees"
        title="組織與簽核・員工"
        href="/admin/org/employees"
        purpose="維護員工主檔（編號、姓名、部門、職稱、信箱等），並可指派職務與權限角色；支援活頁簿匯入。"
      >
        <Steps
          items={[
            '開啟「組織與簽核」→「員工」。',
            '用篩選找到員工，或新增一位員工。',
            '編輯時可調整部門、聯絡資料、權限角色與職務類別擔任情形。',
            '若要批次匯入：依畫面上傳公司活頁簿「link」工作表，先預覽再勾選套用。',
          ]}
        />
        <Shot src="/admin-guide/11-org-employees.png" alt="員工資料" caption="員工：搜尋／篩選、新增，頁面下方可匯入 Excel" />
        <Tip>
          停用登入與 Google 綁定仍以「帳號綁定」為主；員工頁著重主檔與職務。
        </Tip>
      </Topic>

      <Topic
        id="org-levels"
        title="組織與簽核・組織層級"
        href="/admin/org/levels"
        purpose="定義組織層級名稱與高低（數字越大通常越高）。簽核積木「簽到某一層級」會用到這裡。"
      >
        <Steps
          items={[
            '開啟「組織層級」分頁。',
            '新增層級或調整名稱／順序。',
            '確認部門已對應到正確層級後，再到表單設計器設定相關簽核關卡。',
          ]}
        />
        <Shot src="/admin-guide/12-org-levels.png" alt="組織層級" caption="組織層級：代號、名稱與高低（數字越大越高）" />
      </Topic>

      <Topic
        id="org-job-roles"
        title="組織與簽核・職務類別"
        href="/admin/org/roles"
        purpose="例如總經理、董事長、單位主管等。用於簽核關卡與表單「誰可以填」的範圍，不是選單權限。"
      >
        <Steps
          items={[
            '開啟「職務類別」分頁。',
            '新增或維護職務名稱與範圍（全公司或指定部門）。',
            '指定擔任者（含主要人員）；系統職務（總經理／董事長）有額外限制，請依畫面提示。',
          ]}
        />
        <Shot src="/admin-guide/13-org-job-roles.png" alt="職務類別" caption="職務類別：新增代號／名稱，並指定擔任者" />
      </Topic>

      <Topic
        id="org-groups"
        title="組織與簽核・員工群組"
        href="/admin/org/groups"
        purpose="把一組員工編成群組，簽核流程可設「依群組成員依序簽」。"
      >
        <Steps
          items={[
            '開啟「員工群組」分頁。',
            '新增群組並依序加入成員。',
            '在表單設計器的簽核流程中引用該群組。',
          ]}
        />
        <Shot src="/admin-guide/14-org-groups.png" alt="員工群組" caption="員工群組：新增後再加入成員（依序簽核）" />
      </Topic>

      <Topic
        id="org-delegations"
        title="組織與簽核・代理人"
        href="/admin/org/delegations"
        purpose="設定某段期間由誰代理簽核（可限全部或部分表單）。產生新關卡時會套用；已在等待的關卡不會自動改派。"
      >
        <Steps
          items={[
            '開啟「代理人」分頁。',
            '新增代理：被代理人、代理人、起迄日期、表單範圍。',
            '到期或不再需要時依畫面撤銷。',
          ]}
        />
        <Shot src="/admin-guide/15-org-delegations.png" alt="代理人" caption="代理人：被代理人、代理人、期間與表單範圍" />
        <Tip>同一期間／範圍不可衝突；代理通常只轉一次，請依畫面錯誤訊息調整。</Tip>
      </Topic>

      <Topic
        id="org-simulator"
        title="組織與簽核・流程模擬"
        href="/admin/org/simulator"
        purpose="用目前組織資料，試算某張已發佈表單在指定申請人／欄位下會出現哪些簽核人。不寫入任何單據。"
      >
        <Steps
          items={[
            '開啟「流程模擬」分頁。',
            '選擇表單、申請人，並填入流程會參考的欄位（若有）。',
            '執行模擬，核對關卡與人員是否符合預期。',
            '若結果不對，回到部門／職務／流程設計調整後再模擬。',
          ]}
        />
        <Shot src="/admin-guide/16-org-simulator.png" alt="流程模擬" caption="流程模擬：選表單與申請人後試算簽核人（不寫入）" />
      </Topic>

      <Topic
        id="org-directory"
        title="組織與簽核・人員同步"
        href="/admin/org/directory"
        purpose="檢視 Google Workspace 目錄同步結果，處理新進、資料異動、離職／停權等審核（需公司核准同步帳號後才有完整資料）。"
      >
        <Steps
          items={[
            '開啟「人員同步」分頁。',
            '查看最近同步狀態與授權是否正常。',
            '依區塊處理：新進建立員工、勾選套用異動、確認離職後再停用。',
            '建立員工後，對方首次登入仍可能需在「帳號綁定」核准（視信箱是否已寫入主檔而定）。',
          ]}
        />
        <Shot src="/admin-guide/17-org-directory.png" alt="人員同步" caption="人員同步：同步狀態、新進建立、資料異動與離職處理" />
      </Topic>

      <Topic
        id="forms-list"
        title="表單設計器・列表"
        href="/admin/form-builder"
        purpose="管理所有可設計的表單：新增、開啟編輯、複製、暫停／重新發佈、刪除。"
      >
        <Steps
          items={[
            '「系統管理」→「表單設計器」。',
            '「新增表單」建立空白草稿，或從既有表單「複製」。',
            '對已發佈表單可「暫停」（選單隱藏、不可新填）；暫停後可「重新發佈」。',
            '刪除前確認權限與是否仍有單據／相依；畫面會說明是移除或隱藏。',
          ]}
        />
        <Shot src="/admin-guide/18-form-builder-list.png" alt="表單設計器列表" caption="列表：新增、編輯、複製、暫停／刪除" />
      </Topic>

      <Topic
        id="forms-design"
        title="表單設計器・編輯與發佈"
        href="/admin/form-builder"
        purpose="編輯草稿：欄位設計 → 簽核流程 → 發佈設定 → 預覽 → 版本與發佈。建議先模擬簽核人再正式發佈。"
      >
        <Steps
          items={[
            '從列表點進一張表單（草稿或已發佈的目前草稿）。',
            '「欄位設計」：從元件庫加入欄位／明細表，在畫布調整必填與屬性（會自動存草稿）。',
            '「簽核流程」：用積木排出關卡，右側可試算簽核人。',
            '「發佈設定」：名稱、代號、字首、分類、可填寫範圍等。',
            '「預覽」試填畫面（不產生正式單據）。',
            '確認無誤後在「版本與發佈」發佈；發佈後才會出現在員工「申請表單」。',
          ]}
        />
        <Shot src="/admin-guide/20-form-designer-fields.png" alt="欄位設計" caption="欄位設計：畫布編輯欄位，底部元件庫可點選或拖曳加入" />
        <Shot src="/admin-guide/21-form-designer-flow.png" alt="簽核流程" caption="簽核流程：用積木排出關卡，右側可試算簽核人" />
        <Shot src="/admin-guide/22-form-designer-publish.png" alt="版本與發佈" caption="版本與發佈：發佈新版本、暫停、複製與版本紀錄" />
        <Tip>
          <ul className="list-disc space-y-1 pl-5">
            <li>已送出的單永遠依「送出當時」的版本，不受之後重新發佈影響。</li>
            <li>修改設計器需 1 小時內登入過；刪除表單需要額外的「刪除表單」權限。</li>
          </ul>
        </Tip>
      </Topic>

      <Topic
        id="master"
        title="主檔資料"
        href="/admin/master-data"
        purpose="部門、員工、預算、供應商等資料的唯讀總覽，方便核對。日常新增／修改請到組織、帳號或財會相關功能。"
      >
        <Steps
          items={[
            '「系統管理」→「主檔資料」。',
            '切換區塊查看各類主檔。',
            '若要改資料：部門／員工 → 組織與簽核；登入與角色 → 帳號與權限；預算 → 財會「預算編號管理」。',
          ]}
        />
        <Shot src="/admin-guide/19-master-data.png" alt="主檔資料" caption="主檔資料總覽：部門、員工、預算、供應商" />
      </Topic>
    </main>
  );
}
