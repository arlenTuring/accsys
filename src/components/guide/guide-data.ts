export type GuideRoleTier = 'staff' | 'finance' | 'admin';

export type GuideVisualStep = {
  stepNumber: number;
  /** 簡短動作標題（不超過 18 字） */
  title: string;
  /** 一句話操作提示（不寫長篇文字） */
  hint: string;
  /** 畫面上要點擊的目標位置標籤 */
  targetLabel: string;
  /** 實機截圖或高解析流程畫面路徑 */
  imageSrc: string;
  imageAlt: string;
  /** 直接前往該功能的連結 */
  href: string;
  linkLabel: string;
};

export type GuideScenario = {
  id: string;
  tier: GuideRoleTier;
  /** 使用者今日遇到的真實情境 */
  scenarioTitle: string;
  /** 情境短標籤 */
  scenarioTag: string;
  /** 該情境對應需要使用的系統功能名稱 */
  featureName: string;
  /** 該功能的主入口連結 */
  featureHref: string;
  /** 3 步驟圖片流程 */
  steps: GuideVisualStep[];
};

export type GuideQaStep = {
  stepNumber: number;
  /** 一句話提示 */
  prompt: string;
  /** 步驟對應的照片／畫面截圖 */
  imageSrc: string;
  imageAlt: string;
  /** 直接前往連結 */
  href: string;
  linkLabel: string;
};

export type GuideQaItem = {
  id: string;
  tier: GuideRoleTier;
  question: string;
  tag: string;
  steps: GuideQaStep[];
};

export const ROLE_TIER_META: Record<
  GuideRoleTier,
  {
    id: GuideRoleTier;
    label: string;
    badge: string;
    visibilityRule: string;
    accentClass: string;
    activeTabClass: string;
  }
> = {
  staff: {
    id: 'staff',
    label: '👤 一般使用者',
    badge: '全體同仁適用',
    visibilityRule: '所有登入帳號皆可檢視：日常建單、報帳、出差、用印、待辦簽核與資產確認',
    accentClass: 'border-blue-200 bg-blue-50/70 text-blue-900',
    activeTabClass: 'bg-td-blue text-white shadow-sm ring-2 ring-td-blue/30',
  },
  finance: {
    id: 'finance',
    label: '💰 財會人員',
    badge: '財會＆管理員可見',
    visibilityRule: '僅財會人員與系統管理員可見：專案主檔、年度預算派發／審核／分析、全公司財產清冊與盤點複核',
    accentClass: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
    activeTabClass: 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/30',
  },
  admin: {
    id: 'admin',
    label: '🛡️ 系統管理員',
    badge: '僅系統管理員可見',
    visibilityRule: '僅系統管理員可見：Google 人員同步、帳號角色權限、組織簽核層級、全公司簽核追蹤、表單設計與功能授權',
    accentClass: 'border-purple-200 bg-purple-50/70 text-purple-900',
    activeTabClass: 'bg-purple-700 text-white shadow-sm ring-2 ring-purple-700/30',
  },
};

export const GUIDE_SCENARIOS: GuideScenario[] = [
  {
    id: 'staff-ai-invoice',
    tier: 'staff',
    scenarioTag: '情境 1｜拍發票快速報帳',
    scenarioTitle: '我買了公務用品手上有發票，不想自己找表單慢慢填',
    featureName: 'AI 助手（對話建單＋發票統編檢核）',
    featureHref: '/tools/ai-chat',
    steps: [
      {
        stepNumber: 1,
        title: '開啟 AI 助手並上傳發票',
        hint: '點左側「AI 助手」，再點輸入框左下角「＋」上傳發票或收據照片，並輸入要報支的內容。',
        targetLabel: '🎯 點擊：左側「AI 助手」→ 輸入框左下角「＋」',
        imageSrc: '/guide/real/staff-ai-invoice-1.webp',
        imageAlt: 'AI 助手對話畫面，框出左側 AI 助手與上傳按鈕',
        href: '/tools/ai-chat',
        linkLabel: '前往 AI 助手 →',
      },
      {
        stepNumber: 2,
        title: 'AI 辨識發票並建立草稿',
        hint: 'AI 會讀取發票品項與金額、檢核買方統編是否為本公司，並幫你建立表單草稿（此圖為示意）。',
        targetLabel: '🎯 示意圖：AI 回覆辨識結果與統編檢核',
        imageSrc: '/guide/ai-invoice-ocr.svg?v=3',
        imageAlt: 'AI 助手辨識發票與統編檢核示意圖',
        href: '/tools/ai-chat',
        linkLabel: '立即對話建單 →',
      },
      {
        stepNumber: 3,
        title: '到草稿庫確認後送出',
        hint: 'AI 建好的草稿會存到「我的待辦 → 我的草稿庫」，點「開啟編輯」確認欄位與附件後送出。',
        targetLabel: '🎯 點擊：「我的草稿庫」→ 草稿右側「開啟編輯」',
        imageSrc: '/guide/real/staff-ai-invoice-3.webp',
        imageAlt: '我的草稿庫畫面，框出開啟編輯按鈕',
        href: '/applications/drafts',
        linkLabel: '查看我的草稿庫 →',
      },
    ],
  },
  {
    id: 'staff-file-forms',
    tier: 'staff',
    scenarioTag: '情境 2｜請購・報支・出差・用印',
    scenarioTitle: '我要採購設備、申請出差旅費，或有合約文件需要蓋公司印章',
    featureName: '簽核管理（四大類表單申請中心）',
    featureHref: '/f/purchase-request/new',
    steps: [
      {
        stepNumber: 1,
        title: '從左側「簽核管理」選表單',
        hint: '點左側「簽核管理」，在選單選擇請購單、費用申請單、公出差旅申請單或用印申請單。',
        targetLabel: '🎯 點擊：左側「簽核管理」→ 選擇表單',
        imageSrc: '/guide/real/staff-file-forms-1.webp',
        imageAlt: '簽核管理選單，框出請購單、費用申請單、公出差旅申請單、用印申請單',
        href: '/f/purchase-request/new',
        linkLabel: '開啟請購單 →',
      },
      {
        stepNumber: 2,
        title: '選擇預算編號並填寫明細',
        hint: '先在「預算來源」選預算科目／預算編號，再填寫請款內容；需要多筆時點「＋ 新增一列」。',
        targetLabel: '🎯 填寫：「預算來源」與「＋ 新增一列」',
        imageSrc: '/guide/real/staff-file-forms-2.webp',
        imageAlt: '費用申請單畫面，框出預算來源與新增一列',
        href: '/f/expense-claim/new',
        linkLabel: '開啟費用申請單 →',
      },
      {
        stepNumber: 3,
        title: '點「送出申請」產生案號',
        hint: '填完後點右下角「送出申請」；還沒填完可先「暫存草稿」。送出後到「我的待辦 → 簽核與單據追蹤」看進度。',
        targetLabel: '🎯 點擊：右下角「送出申請」',
        imageSrc: '/guide/real/staff-file-forms-3.webp',
        imageAlt: '請購單底部，框出送出申請按鈕',
        href: '/applications',
        linkLabel: '查看簽核進度 →',
      },
    ],
  },
  {
    id: 'staff-approve-and-track',
    tier: 'staff',
    scenarioTag: '情境 3｜信件內簽核・退回重送',
    scenarioTitle: '我收到待簽核通知信要審核，或我送出的單據被退回需要修改',
    featureName: '信件內一鍵簽核 ＆ 我的待辦（簽核管理）',
    featureHref: '/applications',
    steps: [
      {
        stepNumber: 1,
        title: '在通知信裡直接看明細',
        hint: '簽核通知信會列出單據類型、案號、申請人、目前關卡與完整欄位明細，不必登入系統查看。',
        targetLabel: '🎯 查看：信件內的單據摘要與明細',
        imageSrc: '/guide/real/email-preview-1.webp',
        imageAlt: '簽核通知信內容，框出單據摘要',
        href: '/applications',
        linkLabel: '前往簽核管理 →',
      },
      {
        stepNumber: 2,
        title: '信件內點「準許簽核」或「簽核退回」',
        hint: '信件下方「郵件直接簽核作業」有兩個按鈕，點「準許簽核」或「簽核退回」即可完成這一關。',
        targetLabel: '🎯 點擊：信件下方「準許簽核」／「簽核退回」',
        imageSrc: '/guide/real/email-preview-2.webp',
        imageAlt: '簽核通知信底部，框出準許簽核與簽核退回按鈕',
        href: '/applications',
        linkLabel: '前往簽核管理 →',
      },
      {
        stepNumber: 3,
        title: '系統內「待我簽核」快速審核',
        hint: '也可點「我的待辦 → 簽核與單據追蹤」，在「待我簽核」區塊的卡片上直接快速簽核或退回。',
        targetLabel: '🎯 點擊：「簽核與單據追蹤」→「待我簽核」',
        imageSrc: '/guide/real/staff-approve-2.webp',
        imageAlt: '簽核管理畫面，框出待我簽核頁籤與區塊',
        href: '/applications',
        linkLabel: '前往待我簽核 →',
      },
    ],
  },
  {
    id: 'staff-budget-and-assets',
    tier: 'staff',
    scenarioTag: '情境 4｜填年度預算・確認名下財產',
    scenarioTitle: '我收到財會派發的年度預算填報通知，或收到名下財產清點單要確認',
    featureName: '我的待辦（年度預算填報 ＆ 我的資產管理）',
    featureHref: '/my-tasks/budget',
    steps: [
      {
        stepNumber: 1,
        title: '填寫財會派發的年度預算表',
        hint: '點「我的待辦 → 年度預算表填報」，在「財會部門派發之待填預算編列單」點開派發單填寫 1~12 月預算（自動儲存）。',
        targetLabel: '🎯 點擊：「年度預算表填報」→ 待填預算編列單',
        imageSrc: '/guide/real/staff-budget-1.webp',
        imageAlt: '年度預算表填報畫面，框出選單與待填預算編列單',
        href: '/my-tasks/budget',
        linkLabel: '前往年度預算表填報 →',
      },
      {
        stepNumber: 2,
        title: '在「我的資產管理」確認清點單',
        hint: '點「我的待辦 → 我的資產管理」查看名下資產；財會派發清點單後，依頁面提示逐筆點「確認」或「修改」。',
        targetLabel: '🎯 點擊：「我的資產管理」→ 名下資產清單',
        imageSrc: '/guide/real/staff-assets-2.webp',
        imageAlt: '我的資產管理畫面，框出選單與資產清單',
        href: '/assets/mine',
        linkLabel: '前往我的資產管理 →',
      },
      {
        stepNumber: 3,
        title: '勾選資產帶入《資產異動申請單》',
        hint: '設備要移交或報廢時，勾選該筆資產（可多筆），或點該列「操作」欄的「轉移」，系統會自動帶入《資產異動申請單》。',
        targetLabel: '🎯 點擊：勾選資產 → 「操作」欄「轉移」',
        imageSrc: '/guide/real/staff-assets-3.webp',
        imageAlt: '我的資產管理畫面，框出批次轉移提示與操作欄',
        href: '/assets/mine',
        linkLabel: '前往我的資產管理 →',
      },
    ],
  },
  {
    id: 'staff-company-and-pdf',
    tier: 'staff',
    scenarioTag: '情境 5｜查公司規章・PDF 加註簽名',
    scenarioTitle: '我想查出差住宿補助上限、看公司公告，或在 PDF 上加註並簽名',
    featureName: '公司資訊（公告／規章／問卷）＆ PDF 編輯器',
    featureHref: '/regulations',
    steps: [
      {
        stepNumber: 1,
        title: '點左上角 Logo 查公告與規章',
        hint: '點最左上角公司標誌，即可切換「公司公告」、「公司規章」與「內部問卷」。',
        targetLabel: '🎯 點擊：左上角公司 Logo → 公司公告／公司規章／內部問卷',
        imageSrc: '/guide/real/staff-company-1.webp',
        imageAlt: '公司公告畫面，框出左上角 Logo 與公司資訊選單',
        href: '/announcements',
        linkLabel: '前往公司公告 →',
      },
      {
        stepNumber: 2,
        title: '直接問 AI 助手規章條文',
        hint: '在 AI 助手輸入框輸入問題，例如「出差住宿費上限多少？」，AI 會引用公司規章回答。',
        targetLabel: '🎯 輸入：AI 助手輸入框',
        imageSrc: '/guide/real/staff-company-2.webp',
        imageAlt: 'AI 助手輸入框已填入規章問題',
        href: '/tools/ai-chat',
        linkLabel: '前往 AI 助手 →',
      },
      {
        stepNumber: 3,
        title: '用 PDF 編輯器加註與簽名',
        hint: '點左側「工具區 → PDF 編輯器」，點「選擇 PDF」或拖入檔案，加入文字、圖片（如簽名檔）、框線或螢光筆後匯出新檔。',
        targetLabel: '🎯 點擊：「工具區」→「PDF 編輯器」→「選擇 PDF」',
        imageSrc: '/guide/real/staff-company-3.webp',
        imageAlt: 'PDF 編輯器畫面，框出工具區、PDF 編輯器與選擇 PDF',
        href: '/tools/pdf-editor',
        linkLabel: '開啟 PDF 編輯器 →',
      },
    ],
  },
  {
    id: 'finance-project-master',
    tier: 'finance',
    scenarioTag: '財會情境 1｜專案主檔新增・停用・刪除',
    scenarioTitle: '我要建立新年度專案代碼，並整理歷史專案（停用已用專案、刪除未用專案）',
    featureName: '預算管理平台 → 主檔管理',
    featureHref: '/budget-codes/projects',
    steps: [
      {
        stepNumber: 1,
        title: '在「主檔管理」新增專案',
        hint: '點「財會管理 → 預算管理平台 → 主檔管理」，在「建立新專案」輸入專案代碼與名稱，點「新增專案」。',
        targetLabel: '🎯 點擊：「主檔管理」→「新增專案」',
        imageSrc: '/guide/real/fin-project-1.webp',
        imageAlt: '主檔管理畫面，框出選單與新增專案按鈕',
        href: '/budget-codes/projects',
        linkLabel: '前往主檔管理 →',
      },
      {
        stepNumber: 2,
        title: '未使用的專案可直接刪除',
        hint: '清單預設最新在前；「使用與預算狀態」顯示「未使用（可刪除）」的專案，可直接點「刪除」。',
        targetLabel: '🎯 點擊：狀態「未使用（可刪除）」→「刪除」',
        imageSrc: '/guide/real/fin-project-2.webp',
        imageAlt: '專案清單，框出未使用狀態與刪除按鈕',
        href: '/budget-codes/projects',
        linkLabel: '前往主檔管理 →',
      },
      {
        stepNumber: 3,
        title: '已使用的專案點「停用」封存',
        hint: '已建立預算單或被單據引用的專案不能刪除（可用「有使用到（可停用）」篩選），點「停用」即可封存。',
        targetLabel: '🎯 點擊：「有使用到（可停用）」篩選 →「停用」',
        imageSrc: '/guide/real/fin-project-3.webp',
        imageAlt: '專案清單，框出可停用篩選與停用按鈕',
        href: '/budget-codes/projects',
        linkLabel: '前往主檔管理 →',
      },
    ],
  },
  {
    id: 'finance-budget-dispatch',
    tier: 'finance',
    scenarioTag: '財會情境 2｜建立預算・派發各部門填報',
    scenarioTitle: '年度預算開跑，我要建立預算科目並派發預算編列任務給各部門與專案主管',
    featureName: '預算管理平台 → 建立預算 ＆ 派發任務',
    featureHref: '/budget-codes/overview',
    steps: [
      {
        stepNumber: 1,
        title: '進入「建立預算」查看規劃表',
        hint: '點「預算管理平台 → 建立預算」，檢視各年度部門／專案預算規劃表，或點「＋ 新增預算規劃」。',
        targetLabel: '🎯 點擊：「建立預算」→「＋ 新增預算規劃」',
        imageSrc: '/guide/real/fin-budget-1.webp',
        imageAlt: '建立預算畫面，框出選單與新增預算規劃',
        href: '/budget-codes/overview',
        linkLabel: '前往建立預算 →',
      },
      {
        stepNumber: 2,
        title: '點「寄送」派發給負責人填寫',
        hint: '在規劃表列點「寄送」，派發給對象主管／專案負責人，系統會自動寄送填報通知信。',
        targetLabel: '🎯 點擊：規劃表列右側「寄送」',
        imageSrc: '/guide/real/fin-budget-2.webp',
        imageAlt: '預算規劃清單，框出寄送按鈕',
        href: '/budget-codes/overview',
        linkLabel: '前往建立預算 →',
      },
      {
        stepNumber: 3,
        title: '在「預算管理」追蹤回傳',
        hint: '受派主管於「我的待辦 → 年度預算表填報」填寫送出後，財會可在「預算管理」查看各部門預算表與變更表。',
        targetLabel: '🎯 點擊：「預算管理」→ 預算表清單',
        imageSrc: '/guide/real/fin-budget-3.webp',
        imageAlt: '預算管理畫面，框出選單與清單區',
        href: '/budget-codes/management',
        linkLabel: '前往預算管理 →',
      },
    ],
  },
  {
    id: 'finance-budget-review-analysis',
    tier: 'finance',
    scenarioTag: '財會情境 3｜預算審核・差異分析報告',
    scenarioTitle: '各部門送出預算表後，我要審核 1~12 月分月明細並發布跨年度預算差異分析',
    featureName: '預算管理平台 → 預算管理 ＆ 預算分析',
    featureHref: '/budget-codes/management',
    steps: [
      {
        stepNumber: 1,
        title: '依年度與類型查看預算表',
        hint: '點「預算管理」，選年度與單據類型（部門預算表／專案預算表／預算變更表），點任一筆查看 1~12 月明細。',
        targetLabel: '🎯 點擊：年度 → 單據類型篩選',
        imageSrc: '/guide/real/fin-review-1.webp',
        imageAlt: '預算管理畫面，框出年度與單據類型篩選',
        href: '/budget-codes/management',
        linkLabel: '前往預算管理 →',
      },
      {
        stepNumber: 2,
        title: '預算表送出後走簽核流程',
        hint: '部門送出的預算表會進入簽核；清單上可看到每張的狀態（簽核中、已核准、退回修改）。',
        targetLabel: '🎯 查看：清單上的單據狀態',
        imageSrc: '/guide/real/fin-budget-3.webp',
        imageAlt: '預算管理清單區',
        href: '/budget-codes/management',
        linkLabel: '前往預算管理 →',
      },
      {
        stepNumber: 3,
        title: '在「預算分析」產出報告',
        hint: '點「預算分析」，選擇年度、部門或專案查看預算執行率與差異圖表，點「報告產出」匯出報告。',
        targetLabel: '🎯 點擊：「預算分析」→「報告產出」',
        imageSrc: '/guide/real/fin-review-3.webp',
        imageAlt: '預算分析畫面，框出選單與報告產出按鈕',
        href: '/budget-codes/analysis',
        linkLabel: '前往預算分析 →',
      },
    ],
  },
  {
    id: 'finance-assets-and-inventory',
    tier: 'finance',
    scenarioTag: '財會情境 4｜全公司財產清冊・盤點派發複核',
    scenarioTitle: '新買設備要登錄財產清冊，或要發起全公司財產盤點並進行清點人複核結案',
    featureName: '全公司財產清冊 ＆ 財產盤點管理',
    featureHref: '/assets',
    steps: [
      {
        stepNumber: 1,
        title: '維護全公司財產清冊',
        hint: '點「財會管理 → 全公司財產清冊」，可「＋ 新增財產」，或用「匯入」／「匯出」批次處理 Excel。',
        targetLabel: '🎯 點擊：「匯入」／「匯出」／「＋ 新增財產」',
        imageSrc: '/guide/real/fin-assets-1.webp',
        imageAlt: '全公司財產清冊，框出匯入、匯出與新增財產',
        href: '/assets',
        linkLabel: '前往全公司財產清冊 →',
      },
      {
        stepNumber: 2,
        title: '選保管人並發送清點單',
        hint: '點「財會管理 → 財產盤點」，選擇保管人、指定清點時間與方式，點「發送財產清點單」。',
        targetLabel: '🎯 點擊：選擇保管人 → 指定時間 →「發送財產清點單」',
        imageSrc: '/guide/real/fin-inventory-2.webp',
        imageAlt: '財產盤點畫面，框出保管人、清點時間與發送按鈕',
        href: '/assets/inventory-forms',
        linkLabel: '前往財產盤點 →',
      },
      {
        stepNumber: 3,
        title: '雙方確認後結案並匯出',
        hint: '保管人確認後，清點人點入清點單做第二階段確認；雙方都確認即結案，可點「匯出盤點用 Excel」。',
        targetLabel: '🎯 點擊：狀態頁籤 →「匯出盤點用 Excel」',
        imageSrc: '/guide/real/fin-inventory-3.webp',
        imageAlt: '財產盤點清單，框出狀態頁籤與匯出按鈕',
        href: '/assets/inventory-forms',
        linkLabel: '前往財產盤點 →',
      },
    ],
  },
  {
    id: 'admin-onboarding-and-roles',
    tier: 'admin',
    scenarioTag: '管理員情境 1｜新進／離職人員同步・權限角色',
    scenarioTitle: '公司有新進同仁報到或人員離職，我要從 Google 同步名單並設定他的系統角色',
    featureName: '組織簽核（人員同步）＆ 帳號權限',
    featureHref: '/admin/org/directory',
    steps: [
      {
        stepNumber: 1,
        title: '在「人員同步」建立新進人員',
        hint: '點「系統管理 → 組織簽核 → 人員同步」，查看 Google Workspace 同步結果，在「新進人員」為新同仁建立員工。',
        targetLabel: '🎯 點擊：「人員同步」頁籤 →「新進人員」',
        imageSrc: '/guide/real/adm-directory.webp',
        imageAlt: '人員同步畫面，框出頁籤與新進人員',
        href: '/admin/org/directory',
        linkLabel: '前往人員同步 →',
      },
      {
        stepNumber: 2,
        title: '核准 Google 帳號或停用離職者',
        hint: '點「系統管理 → 帳號權限」，在「待處理的 Google 帳號」核准綁定；離職人員點該列「停用」。',
        targetLabel: '🎯 點擊：「待處理的 Google 帳號」／「停用」',
        imageSrc: '/guide/real/adm-accounts.webp',
        imageAlt: '帳號與權限畫面，框出待處理帳號與停用按鈕',
        href: '/admin/accounts',
        linkLabel: '前往帳號權限 →',
      },
      {
        stepNumber: 3,
        title: '指派角色（一般／財會／管理員）',
        hint: '在員工列的「角色」下拉選單指派一般員工、財會或系統管理員；要調整角色權限內容請到「權限角色」頁籤。',
        targetLabel: '🎯 點擊：員工列「角色」下拉／「權限角色」頁籤',
        imageSrc: '/guide/real/adm-roles.webp',
        imageAlt: '帳號與權限畫面，框出角色下拉與權限角色頁籤',
        href: '/admin/accounts',
        linkLabel: '前往帳號權限 →',
      },
    ],
  },
  {
    id: 'admin-org-and-approval-routing',
    tier: 'admin',
    scenarioTag: '管理員情境 2｜部門主管・職務代理人・簽核模擬',
    scenarioTitle: '部門主管異動、主管請假要設定職務代理人，或要調整金額核決層級並測試流程',
    featureName: '組織簽核（部門／層級／代理人／流程模擬）',
    featureHref: '/admin/org',
    steps: [
      {
        stepNumber: 1,
        title: '設定部門主管與組織層級',
        hint: '點「系統管理 → 組織簽核」，在「部門」頁籤點「編輯」設定主管，在「組織層級」設定層級。',
        targetLabel: '🎯 點擊：「部門」／「組織層級」頁籤',
        imageSrc: '/guide/real/adm-org.webp',
        imageAlt: '組織與簽核設定，框出部門與組織層級頁籤',
        href: '/admin/org',
        linkLabel: '前往組織簽核 →',
      },
      {
        stepNumber: 2,
        title: '設定主管請假時的代理人',
        hint: '切換到「代理人與經辦人」頁籤，在「新增簽核代理人」選被代理人、代理人與起訖日期。',
        targetLabel: '🎯 點擊：「代理人與經辦人」→「新增簽核代理人」',
        imageSrc: '/guide/real/adm-delegations.webp',
        imageAlt: '代理人設定畫面，框出新增簽核代理人',
        href: '/admin/org/delegations',
        linkLabel: '前往代理人設定 →',
      },
      {
        stepNumber: 3,
        title: '用「流程模擬」驗證簽核關卡',
        hint: '切換到「流程模擬」，選擇表單、申請人與送出日期，點「試算簽核流程」預覽每一關簽核人。',
        targetLabel: '🎯 點擊：「流程模擬」→「試算簽核流程」',
        imageSrc: '/guide/real/adm-simulator.webp',
        imageAlt: '流程模擬畫面，框出頁籤與試算按鈕',
        href: '/admin/org/simulator',
        linkLabel: '前往流程模擬 →',
      },
    ],
  },
  {
    id: 'admin-case-tracking-and-logs',
    tier: 'admin',
    scenarioTag: '管理員情境 3｜全公司簽核追蹤・展開單據內文',
    scenarioTitle: '老闆或同仁詢問某張單據卡在哪一關，我要查看全公司所有單據的簽核狀況與完整內文',
    featureName: '系統管理 → 簽核追蹤 ＆ 系統日誌',
    featureHref: '/case-tracking',
    steps: [
      {
        stepNumber: 1,
        title: '進入「簽核追蹤」看全公司單據',
        hint: '點「系統管理 → 簽核追蹤」，用「單據大類」切換採購、費用與差旅、用印、資產等類別。',
        targetLabel: '🎯 點擊：「簽核追蹤」→「單據大類」',
        imageSrc: '/guide/real/adm-case-1.webp',
        imageAlt: '簽核追蹤畫面，框出選單與單據大類',
        href: '/case-tracking',
        linkLabel: '前往簽核追蹤 →',
      },
      {
        stepNumber: 2,
        title: '篩選後展開單據內文',
        hint: '設定部門、表單種類、日期或關鍵字後點「套用篩選」，再點清單中的單據展開完整內文與各關簽核紀錄（僅供追蹤，不在此代簽）。',
        targetLabel: '🎯 點擊：「套用篩選」→ 清單中的單據',
        imageSrc: '/guide/real/adm-case-2.webp',
        imageAlt: '簽核追蹤畫面，框出套用篩選與單據清單',
        href: '/case-tracking',
        linkLabel: '前往簽核追蹤 →',
      },
      {
        stepNumber: 3,
        title: '在「系統日誌」查稽核紀錄',
        hint: '點「系統管理 → 系統日誌」，切換「權限異動查詢」、「系統操作紀錄」、「登入登出紀錄」或「助手對話紀錄」。',
        targetLabel: '🎯 點擊：「系統日誌」→ 上方四個頁籤',
        imageSrc: '/guide/real/adm-logs.webp',
        imageAlt: '系統日誌畫面，框出選單與四個頁籤',
        href: '/admin/system-logs',
        linkLabel: '前往系統日誌 →',
      },
    ],
  },
  {
    id: 'admin-forms-and-company-content',
    tier: 'admin',
    scenarioTag: '管理員情境 4｜表單設計・公告／規章／問卷發布',
    scenarioTitle: '公司要調整表單欄位與簽核關卡，或要發布全公司公告、管理辦法規章與內部問卷',
    featureName: '表單設計器 ＆ 公告／規章／問卷管理',
    featureHref: '/admin/form-builder',
    steps: [
      {
        stepNumber: 1,
        title: '在「表單設計」編輯表單',
        hint: '點「系統管理 → 表單設計」，在要修改的表單列點「編輯」進入設計器調整欄位。',
        targetLabel: '🎯 點擊：「表單設計」→ 表單列「編輯」',
        imageSrc: '/guide/real/adm-forms-1.webp',
        imageAlt: '表單設計器清單，框出選單與編輯按鈕',
        href: '/admin/form-builder',
        linkLabel: '前往表單設計 →',
      },
      {
        stepNumber: 2,
        title: '設定簽核流程並發佈新版本',
        hint: '在設計器切到「簽核流程」調整關卡，再到「版本與發佈」發佈；之後新送出的單據會套用新版本。',
        targetLabel: '🎯 點擊：「簽核流程」→「版本與發佈」',
        imageSrc: '/guide/real/adm-forms-2.webp',
        imageAlt: '表單設計器，框出簽核流程與版本與發佈頁籤',
        href: '/admin/form-builder',
        linkLabel: '前往表單設計 →',
      },
      {
        stepNumber: 3,
        title: '發布公告、規章與問卷',
        hint: '點「公告管理」、「規章管理」或「問卷管理」，用右上角按鈕（如「新增公告」）建立內容並發布。',
        targetLabel: '🎯 點擊：公告／規章／問卷管理 → 右上角新增',
        imageSrc: '/guide/real/adm-forms-3.webp',
        imageAlt: '公告管理畫面，框出三個選單與新增公告',
        href: '/admin/announcements',
        linkLabel: '前往公告管理 →',
      },
    ],
  },
  {
    id: 'admin-license-company-email',
    tier: 'admin',
    scenarioTag: '管理員情境 5｜功能授權碼・統編設定・信箱測試',
    scenarioTitle: '我要更新系統模組授權碼、確認 AI 發票檢核用的公司統編，或測試簽核通知信寄送',
    featureName: '功能授權 ＆ 公司資料 ＆ 信箱設定',
    featureHref: '/admin/feature-flags',
    steps: [
      {
        stepNumber: 1,
        title: '在「功能授權」套用授權碼',
        hint: '點「系統管理 → 功能授權」，在「更換系統授權碼」貼上授權碼，點「套用授權碼」更新模組與效期。',
        targetLabel: '🎯 點擊：「更換系統授權碼」→「套用授權碼」',
        imageSrc: '/guide/real/adm-license-1.webp',
        imageAlt: '功能授權畫面，框出授權碼輸入與套用按鈕',
        href: '/admin/feature-flags',
        linkLabel: '前往功能授權 →',
      },
      {
        stepNumber: 2,
        title: '在「公司資料」設定統一編號',
        hint: '點「系統管理 → 公司資料」設定公司正式名稱與 8 碼統一編號，AI 助手檢核發票買方統編時會用這組資料。',
        targetLabel: '🎯 填寫：「公司資料」→「統一編號（8 碼）」',
        imageSrc: '/guide/real/adm-company.webp',
        imageAlt: '公司資訊畫面，框出統一編號欄位',
        href: '/admin/company',
        linkLabel: '前往公司資料 →',
      },
      {
        stepNumber: 3,
        title: '在「信箱設定」寄送測試信',
        hint: '點「系統管理 → 信箱設定」，確認寄信設定後，在「立即發送測試信」點「發送測試信到我的信箱」。',
        targetLabel: '🎯 點擊：「信箱設定」→「發送測試信到我的信箱」',
        imageSrc: '/guide/real/adm-email.webp',
        imageAlt: '信箱設定畫面，框出發送測試信按鈕',
        href: '/admin/email-settings',
        linkLabel: '前往信箱設定 →',
      },
    ],
  },
];

export const GUIDE_QA_ITEMS: GuideQaItem[] = [
  {
    id: 'qa-staff-taxid',
    tier: 'staff',
    tag: 'AI 報帳與發票',
    question: 'Q1：上傳發票給 AI 助手時，被提示「買方統編不符或未填」怎麼辦？',
    steps: [
      {
        stepNumber: 1,
        prompt: '請確認發票「買方統編」是公司的 8 碼統編（系統管理員在「公司資料」設定的那組）；漏打時請店家補蓋統編章後重新上傳。',
        imageSrc: '/guide/ai-invoice-ocr.svg?v=3',
        imageAlt: 'AI 助手統編檢核示意圖',
        href: '/tools/ai-chat',
        linkLabel: '前往 AI 助手重傳 →',
      },
      {
        stepNumber: 2,
        prompt: '若是免統編的收據或車票，在表單「備註」寫明原因即可送出簽核。',
        imageSrc: '/guide/real/expense-remark.webp',
        imageAlt: '費用申請單，框出備註欄',
        href: '/f/expense-claim/new',
        linkLabel: '開啟費用申請單 →',
      },
    ],
  },
  {
    id: 'qa-staff-email-approve',
    tier: 'staff',
    tag: '信件內直接簽核',
    question: 'Q2：收到 Gmail 簽核通知信時，可以不用登入系統、直接在信件裡面簽核嗎？',
    steps: [
      {
        stepNumber: 1,
        prompt: '可以。通知信會完整列出單據摘要與欄位明細，不必登入系統查看。',
        imageSrc: '/guide/real/email-preview-1.webp',
        imageAlt: '簽核通知信的單據摘要',
        href: '/applications',
        linkLabel: '查看待我簽核清單 →',
      },
      {
        stepNumber: 2,
        prompt: '在信件下方點「準許簽核」或「簽核退回」即可完成這一關。',
        imageSrc: '/guide/real/email-preview-2.webp',
        imageAlt: '簽核通知信的準許簽核與簽核退回按鈕',
        href: '/applications',
        linkLabel: '前往簽核管理 →',
      },
    ],
  },
  {
    id: 'qa-staff-returned-edit',
    tier: 'staff',
    tag: '退回修改與撤回',
    question: 'Q3：單據送出後發現填錯了，或是被主管退回，要怎麼修改重送？',
    steps: [
      {
        stepNumber: 1,
        prompt: '點左側「我的待辦 → 簽核與單據追蹤」，切到「已退回」或「簽核中」頁籤找到該張單據。',
        imageSrc: '/guide/real/staff-approve-3.webp',
        imageAlt: '簽核管理，框出簽核中與已退回頁籤',
        href: '/applications',
        linkLabel: '前往簽核與單據追蹤 →',
      },
      {
        stepNumber: 2,
        prompt: '點開單據：簽核中可按「撤回」，被退回的單據可按「修改並重新送出」，原本填寫的資料與附件都會保留。',
        imageSrc: '/guide/real/staff-approve-3.webp',
        imageAlt: '簽核管理頁籤',
        href: '/applications',
        linkLabel: '前往簽核與單據追蹤 →',
      },
    ],
  },
  {
    id: 'qa-staff-budget-owner-rule',
    tier: 'staff',
    tag: '預算編號規則',
    question: 'Q4：為什麼同一張請購單或費用單，不能同時選兩個不同部門／不同負責人的預算編號？',
    steps: [
      {
        stepNumber: 1,
        prompt: '請購單上已註明：一張請購單的所有預算編號必須屬於同一位預算負責人，因為系統依預算編號自動分派負責人簽核。',
        imageSrc: '/guide/real/purchase-budget-rule.webp',
        imageAlt: '請購單，框出同一位預算負責人的提醒',
        href: '/f/purchase-request/new',
        linkLabel: '開啟請購單 →',
      },
      {
        stepNumber: 2,
        prompt: '跨不同預算負責人的項目請分成兩張單送出，也可以直接請 AI 助手幫你拆單建立。',
        imageSrc: '/guide/real/staff-company-2.webp',
        imageAlt: 'AI 助手輸入框',
        href: '/tools/ai-chat',
        linkLabel: '前往 AI 助手 →',
      },
    ],
  },
  {
    id: 'qa-staff-asset-transfer',
    tier: 'staff',
    tag: '名下財產移交',
    question: 'Q5：我名下保管的筆電或測試設備要移交給其他同事，要從哪裡發起？',
    steps: [
      {
        stepNumber: 1,
        prompt: '點「我的待辦 → 我的資產管理」，勾選要移交的設備（可多筆）或點該列「操作」欄的「轉移」。',
        imageSrc: '/guide/real/staff-assets-3.webp',
        imageAlt: '我的資產管理，框出批次轉移提示與操作欄',
        href: '/assets/mine',
        linkLabel: '前往我的資產管理 →',
      },
      {
        stepNumber: 2,
        prompt: '系統會把資產帶入《資產異動申請單》，勾選「異動說明」並在明細填新保管人後送出簽核。',
        imageSrc: '/guide/real/asset-transfer-form.webp',
        imageAlt: '資產異動申請單，框出異動說明',
        href: '/f/asset-transfer/new',
        linkLabel: '開啟資產異動申請單 →',
      },
    ],
  },
  {
    id: 'qa-fin-project-disable-vs-delete',
    tier: 'finance',
    tag: '專案主檔控管',
    question: 'Q6：在預算管理平台的「主檔管理」裡，為什麼有些歷史專案不能刪除只能「停用」？',
    steps: [
      {
        stepNumber: 1,
        prompt: '到「財會管理 → 預算管理平台 → 主檔管理」，看「使用與預算狀態」欄：「未使用（可刪除）」的專案可直接點「刪除」。',
        imageSrc: '/guide/real/fin-project-2.webp',
        imageAlt: '專案清單，框出未使用狀態與刪除',
        href: '/budget-codes/projects',
        linkLabel: '前往專案主檔管理 →',
      },
      {
        stepNumber: 2,
        prompt: '已建立預算單或被單據引用的專案為保護歷史帳務不能刪除，請點「停用」封存。',
        imageSrc: '/guide/real/fin-project-3.webp',
        imageAlt: '專案清單，框出可停用篩選與停用',
        href: '/budget-codes/projects',
        linkLabel: '前往停用或刪除專案 →',
      },
    ],
  },
  {
    id: 'qa-fin-budget-dispatch-how',
    tier: 'finance',
    tag: '年度預算派發',
    question: 'Q7：各部門主管反映在「我的待辦」沒看到年度預算填寫表，財會要從哪裡派發？',
    steps: [
      {
        stepNumber: 1,
        prompt: '到「財會管理 → 預算管理平台 → 建立預算」，在該部門／專案的規劃表列點「寄送」派發。',
        imageSrc: '/guide/real/fin-budget-2.webp',
        imageAlt: '預算規劃清單，框出寄送按鈕',
        href: '/budget-codes/overview',
        linkLabel: '前往建立預算 →',
      },
      {
        stepNumber: 2,
        prompt: '寄送後系統會發通知信，受派主管即可在「我的待辦 → 年度預算表填報」看到待填預算編列單。',
        imageSrc: '/guide/real/staff-budget-1.webp',
        imageAlt: '年度預算表填報畫面',
        href: '/my-tasks/budget',
        linkLabel: '前往年度預算表填報 →',
      },
    ],
  },
  {
    id: 'qa-fin-inventory-dual-stage',
    tier: 'finance',
    tag: '財產盤點結案',
    question: 'Q8：財產清點單派發出去後，要如何完成雙階確認並匯出正式盤點紀錄？',
    steps: [
      {
        stepNumber: 1,
        prompt: '到「財會管理 → 財產盤點」，用「點交確認進行中」／「雙方全數確認已結案」頁籤追蹤各清點單進度。',
        imageSrc: '/guide/real/fin-inventory-3.webp',
        imageAlt: '財產盤點，框出狀態頁籤',
        href: '/assets/inventory-forms',
        linkLabel: '前往財產盤點管理 →',
      },
      {
        stepNumber: 2,
        prompt: '保管人確認後，清點人點入清點單完成第二階段確認；結案後點「匯出盤點用 Excel」。',
        imageSrc: '/guide/real/fin-inventory-3.webp',
        imageAlt: '財產盤點，框出匯出盤點用 Excel',
        href: '/assets/inventory-forms',
        linkLabel: '前往複核與匯出 →',
      },
    ],
  },
  {
    id: 'qa-adm-new-employee-login',
    tier: 'admin',
    tag: '帳號同步與綁定',
    question: 'Q9：新進同仁用公司 Google 帳號登入時無法進入或找不到員工編號，如何處理？',
    steps: [
      {
        stepNumber: 1,
        prompt: '先到「系統管理 → 組織簽核 → 人員同步」，確認新同仁出現在「新進人員」並建立員工。',
        imageSrc: '/guide/real/adm-directory.webp',
        imageAlt: '人員同步畫面',
        href: '/admin/org/directory',
        linkLabel: '前往人員同步 →',
      },
      {
        stepNumber: 2,
        prompt: '再到「系統管理 → 帳號權限」，在「待處理的 Google 帳號」核准綁定，並確認狀態為「啟用」。',
        imageSrc: '/guide/real/adm-accounts.webp',
        imageAlt: '帳號與權限畫面',
        href: '/admin/accounts',
        linkLabel: '前往帳號權限 →',
      },
    ],
  },
  {
    id: 'qa-adm-manager-on-leave',
    tier: 'admin',
    tag: '職務代理人設定',
    question: 'Q10：某部門主管出國或請假，部門同仁的單據卡在主管那關怎麼辦？',
    steps: [
      {
        stepNumber: 1,
        prompt: '到「系統管理 → 組織簽核 → 代理人與經辦人」，在「新增簽核代理人」設定請假主管、代理人與起訖日期。',
        imageSrc: '/guide/real/adm-delegations.webp',
        imageAlt: '新增簽核代理人',
        href: '/admin/org/delegations',
        linkLabel: '前往代理人設定 →',
      },
      {
        stepNumber: 2,
        prompt: '設定後可到「流程模擬」選擇表單與申請人，點「試算簽核流程」確認代理期間由代理人簽核。',
        imageSrc: '/guide/real/adm-simulator.webp',
        imageAlt: '流程模擬',
        href: '/admin/org/simulator',
        linkLabel: '前往流程模擬器 →',
      },
    ],
  },
  {
    id: 'qa-adm-case-tracking-all',
    tier: 'admin',
    tag: '全公司單據追蹤',
    question: 'Q11：如何查看全公司所有單據（包含出差、用印、資產、請採驗）的完整內文與目前卡在哪一關？',
    steps: [
      {
        stepNumber: 1,
        prompt: '點左側「系統管理 → 簽核追蹤」，用「單據大類」與部門、表單種類、日期、關鍵字篩選全公司單據。',
        imageSrc: '/guide/real/adm-case-1.webp',
        imageAlt: '簽核追蹤，框出單據大類',
        href: '/case-tracking',
        linkLabel: '前往全公司簽核追蹤 →',
      },
      {
        stepNumber: 2,
        prompt: '點「套用篩選」後，點清單中的單據展開完整內文與每一關簽核紀錄（此頁僅供追蹤，不在此代簽）。',
        imageSrc: '/guide/real/adm-case-2.webp',
        imageAlt: '簽核追蹤，框出套用篩選與清單',
        href: '/case-tracking',
        linkLabel: '展開單據內文追蹤 →',
      },
    ],
  },
  {
    id: 'qa-adm-license-feature-flags',
    tier: 'admin',
    tag: '功能授權與網址防護',
    question: 'Q12：如何透過授權碼開關「專案助手」等功能模組，並確定關閉後無法用網址偷偷進入？',
    steps: [
      {
        stepNumber: 1,
        prompt: '到「系統管理 → 功能授權」，在「更換系統授權碼」貼上授權碼並點「套用授權碼」，更新模組開關與效期。',
        imageSrc: '/guide/real/adm-license-1.webp',
        imageAlt: '功能授權，框出授權碼套用',
        href: '/admin/feature-flags',
        linkLabel: '前往功能授權 →',
      },
      {
        stepNumber: 2,
        prompt: '每個模組下方列出「網址直連攔截保護路由」；關閉（「暫時關閉」）或未授權的功能會從選單隱藏，直接輸入網址也會被擋下。',
        imageSrc: '/guide/real/adm-license-2.webp',
        imageAlt: '功能授權，框出攔截路由與暫時關閉',
        href: '/admin/feature-flags',
        linkLabel: '檢視目前授權狀態 →',
      },
    ],
  },
];
