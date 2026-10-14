# ACCSYS — 台灣智慧駕駛電子採購與簽核系統

台灣智慧駕駛（Turing Drive）內部使用的電子採購與簽核系統，取代紙本請購／採購／驗收／費用申請流程，並提供對應的簽核、通知與預算維護功能。

## 技術棧

- **框架**：Next.js 16（App Router + Server Actions，Turbopack 建置）、React 19、TypeScript 5（strict）
- **樣式**：Tailwind CSS 3
- **後端 / 資料庫**：PostgreSQL 16 + Drizzle（本機 Docker；正式環境為公司地端主機）
- **測試**：Vitest
- **登入**：Google Workspace OIDC（Authorization Code + PKCE，openid-client）＋ PostgreSQL 可撤銷 session；本機可選開發登入
- **附件**：主機持久目錄
- **Email 通知**：Nodemailer（SMTP，目前程式已就緒但尚未啟用寄送）

## 功能總覽

| 模組 | 說明 |
|---|---|
| 請購單 `/requests` | 建立請購申請、多層簽核、退回重送、送出後第一關審核前可自行修改／撤回 |
| 採購單 `/purchase-orders` | 由已核准請購單衍生，供應商比價、簽核、送出後第一關審核前可自行修改／撤回 |
| 驗收單 `/acceptances` | 採購單驗收、財產編號登錄（限已核准後填寫）、送出後第一關審核前可自行修改／撤回 |
| 費用申請單 `/expense-requests` | 費用申報與核銷簽核、送出後第一關審核前可自行修改／撤回；金額低於 NT$10,000 可免走採購流程直接建立獨立費用申請單 |
| 附件上傳 | 四張表單皆可上傳附件（PDF／圖片） |
| 案件總覽 `/cases/[caseNumber]` | 依案號串聯四張表單狀態，顯示「憑證待補」提醒 |
| 待簽核清單 `/approvals` | 目前登入者所有待簽核項目彙總 |
| 通知中心 `/notifications` | 簽核／退回等系統通知 |
| 主檔資料總覽 `/admin/master-data`（限 `admin`） | 部門、員工、預算編號、供應商唯讀總覽 |
| 帳號與登入綁定 `/admin/accounts`（限 `admin`） | 核准／拒絕 Google 帳號綁定、撤銷綁定、停用／啟用員工、調整角色（需 15 分鐘內登入，全部寫入稽核） |
| 預算編號管理 `/budget-codes`（限 `finance`／`admin`） | 部門／專案預算編號的手動新增/編輯/刪除、Excel 批次匯入、專案主檔管理 |
| 財會簽核追蹤頁 `/case-tracking`（限 `finance`／`admin`） | 全公司案件依「簽核中／已完成／已撤回」分類，可依部門/日期/關鍵字篩選 |

### 角色權限

員工角色分為 `staff`（一般員工）、`finance`（財會）、`admin`（系統管理員），由 `employees.role` 決定；另有 `is_general_manager`／`is_chairman` 標記用於簽核鏈判斷。`admin` 除了專屬的 `/admin/master-data`，也可存取 `finance` 專屬頁面（`/budget-codes`、`/case-tracking`），方便系統管理員做整體驗證，不需另外切換帳號角色。

授權在伺服器端集中檢查（`src/lib/authz/forms.ts`），每個 query、action、API 都會檢查，不依賴頁面或按鈕隱藏：

| 操作 | 允許 |
|---|---|
| 讀取表單、附件（含直接網址） | 申請人、該單任一關簽核人、finance、admin；其他人一律視為「找不到」 |
| 核准／退回 | 只有目前關卡指定的簽核人（admin、finance 不會自動繞過） |
| 修改／撤回／重送 | 申請人，且符合既有狀態規則 |
| 由已核准單據建立後續採購／驗收／費用單 | 來源單據的申請人 |
| 案件總覽 `/cases/…` | 至少能讀其中一張單的人；讀不到的單顯示「無檢視權限」，不給 ID 與狀態 |
| 預算編號、專案維護；財會追蹤 | finance、admin（預算金額只給 finance／admin 看） |
| 帳號綁定、停權、角色 | admin |

費用申請單的完整銀行帳號只給申請人與 finance／admin；簽核人只看到末 4 碼（全形數字一併遮罩）。

- **代為申請的用印單**：經辦人替別人申請（或改由別人修改後重送）時，簽核鏈第一關固定是「申請人確認」，經辦人與最後修改者都會從簽核鏈中移除，不能簽自己送出的單。
- **簽核鏈**：建立或重送時若有任何一關的簽核人帳號已停用，會直接拒絕並請管理員更新主管或預算負責人；總經理／董事長若有多位，固定取最早建立的帳號。
- **外幣匯率**：差旅與費用報銷的匯率必須落在各幣別的合理範圍內（`src/lib/travel-expenses/constants.ts` 的 `RATE_BOUNDS`），避免填錯匯率而改變簽核層級；匯率大幅變動時需調整此範圍。
- **預算編號與專案**：新增、修改、刪除都會寫入稽核紀錄（含修改前後內容）；負責人帳號若已停用，不能指定為負責人。
- **財產異動單**：所填的原保管人、新保管人與其他保管人都必須實際出現在至少一列財產上，避免填入無關的人，讓其單位主管頂替應有的總經理簽核。
- **Email 通知**：寄到員工目前綁定的 Google 帳號 email（隨 Workspace 改名更新），停用帳號不寄；SMTP 強制 TLS（587 需 STARTTLS）並設逾時。
- **伺服器 log**：資料庫錯誤只記錯誤碼、表格與限制名稱與參考碼，不記 SQL 參數與資料內容；正式環境 PostgreSQL 也不記錄查詢參數。

### 簽核流程引擎（`src/lib/approval/flow/`）

- 流程以「積木」定義（JSON，`version: 1`）：簽核關卡的來源可為指定員工、部門主管（可往上 N 層）、部門成員、組織層級（逐級往上簽到指定層級）、表單關係人（申請人／經辦人／表單欄位指定的員工／預算負責人／財產保管人）、員工群組、職務類別；另有條件式積木（依序比對條件，都不符走「其他」）。
- 送出時在交易內讀取當下組織資料並解析成具體簽核步驟，結果固定寫入 `approval_steps`；之後主管異動不影響已送出的單，重送時重新解析。
- 申請人、經辦人或前面已出現的簽核人再次出現時，該關標記「由系統代簽」並記錄原因；明確指定「申請人」本人確認的關卡不會代簽。找不到簽核人時依積木設定擋下送出或略過（略過會留下紀錄）；全部關卡都被代簽時依流程設定自動核准或擋下。
- 代理人：`approval_delegations` 依台北日期與表單範圍生效，步驟記錄原簽核人（時間軸顯示「由 X 代理」）。
- 「第一關審核前可修改／撤回」改為「第一個需要人工決定的關卡之前」，代簽／略過的關卡不算。
- 總經理／董事長改以職務類別 `general_manager`／`chairman` 表示，資料庫 trigger 自動與 `employees.is_general_manager`／`is_chairman` 同步。部門可設上層部門（資料庫擋循環）與組織層級。
- 尚未轉換的內建表單仍使用原本寫死的簽核鏈；`standardFlow` 預設流程已以單元測試證明與舊簽核鏈逐一等價，轉換方式見「內建表單轉換為設計器表單」。各表單明細頁的「簽核流程」時間軸已改用共用元件 `ApprovalTimeline`。

### 自訂表單（`src/lib/custom-forms/`、`/f/<代號>`）

- 表單定義（欄位 + 簽核流程）以「發布版本」保存在 `form_definition_versions`，版本一經發布由資料庫 trigger 禁止修改或刪除；表單代號在第一次發布後不能更改。發布時檢查欄位、流程與欄位引用是否一致，並確認流程指定的員工、部門、群組、職務類別、組織層級都存在且啟用。
- 申請單存在 `form_submissions`（`form_type = 'custom'`），每張單固定使用送出時的版本：之後發布新版本不影響修改、退回重送中的單。表單編號為台北日期 + 字首 + 當日流水號（例：`20261013GA0001`），另有共用案號。
- 伺服器重新驗證所有欄位：未知欄位丟棄、隱藏欄位（條件顯示不成立）不保存、明細表的公式與合計一律由伺服器重算（不採信瀏覽器送來的金額）、引用的員工／部門／預算編號／專案／廠商必須存在。
- 明細表欄位可設定：新增列時的預設選項、文字字數上限、與前面日期／數字欄位比較的檢查規則（例：日期需在出差期間內）。多幣別：數字欄可設為「匯率欄，依幣別」（幣別為 TWD 時固定為 1，外幣必填且需落在 `src/lib/exchange-rates.ts` 的合理範圍內），金額欄可指定「幣別依」某下拉欄以顯示每列幣別；每列幣別不同的金額欄不能當合計欄，需以「金額 × 匯率」的換算欄合計（以整數運算四捨五入到分）。只有預設值、未填其他內容的列視為空白列不保存。
- 預算編號選單顯示「專案或部門：預算負責人（類別｜編號）」。預算編號欄可限定「預算範圍」（部門／產品專案／營收專案）：選單只列該範圍，伺服器送出時再檢查。
- 「廠商」欄位從供應商主檔選擇；選單與明細頁只帶廠商 id 與名稱，不帶銀行資料。
- 文字欄可勾選「敏感資料」（例：匯款帳號）：申請人、經辦、財會、管理員看得到完整內容，其他讀者（含簽核人）由伺服器遮蔽為只剩末四碼數字（`sensitive.ts`）；資料庫仍存原文，稽核紀錄（只能從資料庫讀）保存修改前的完整資料。
- 其他欄位選項：下拉／單選的預設選項（新單預選）；文字欄「不可填入特定內容」規則（可加條件，例：付款方式為匯款時不可填「無」）；明細表數字／金額欄（含換算欄）的「上限」規則，可限定只檢查某下拉欄為指定選項的列（例：材料類單筆不超過新臺幣 10,000 元）。
- 可填寫範圍（`visibility`：部門、職務類別）不符合時與「表單不存在」回應相同。讀取、核准、附件權限與其他表單一致（`canReadForm`、`canAttachToForm`）；附件數另受表單附件欄位的上限限制，沒有附件欄位的表單不能上傳附件。
- 已發布的表單自動出現在「申請表單」選單、`/forms` 與「我的申請」，待簽核清單與數字包含自訂表單。
- 表單由「表單設計器」建立與發布（見下節）；本機啟動時 `npm run seed:forms` 會發布範例「行政採買申請單」（`samples.ts`，只在本機資料庫執行，已存在則略過）。
- 代為申請（經辦）：表單勾選「允許代為申請」後，填寫者可改選申請人（申請人需在職且有該表單填寫權限）。經辦送出的單第一關是「申請人確認」，確認後才送主管；經辦與申請人都能在第一個人工決定前修改／撤回、退回後重送，退回與核准結果同時通知兩人。扣掉經辦與申請人後沒有其他簽核人時拒絕送出。
- 財產相關：「財產」欄位（從財產清冊中保管中／出借中的財產選擇，選單顯示編號、名稱、狀態、數量、保管人）；明細表欄位可為「員工」「財產」，文字／下拉／員工／財產欄可勾「不可重複」，下拉欄可「只能選前面核取方塊已勾選的選項」並可要求「每個勾選項目至少一列」。「財產清冊串接」（整張表單設定）指定財產明細表的財產／異動原因／新保管人員／新保管地點欄與原保管人／新保管人／其他保管人欄位：送出時鎖定財產、檢查仍在清冊中、不在其他簽核中的資產異動（新舊版都算）、所填保管人與清冊一致，並保存送出當下的清冊快照（`form_submission_asset_lines`）；全部核准時清冊必須仍與快照相符才更新保管人、地點與狀態（報廢／出售／合併等），否則拒絕最後核准並請退回；寫入稽核紀錄 `custom.asset_register_applied`。財產有簽核中的申請單時，財產清冊維護也不能改它的保管人。
- 簽核關卡可設為「升級關卡」：只在指定的前面關卡都沒有申請人（含經辦）以外的人簽核時才需要，且不會由申請人本人簽（例：單位主管都是申請人本人時改由總經理、總經理也是本人時改由董事長）。「部門主管」來源可指定員工欄位，取該員工所屬部門的主管。
- 尚未支援：案件總覽／簽核追蹤納入自訂表單、其他核准後自動動作。

### 內建表單轉換為設計器表單（`src/lib/custom-forms/migrated/`）

- 原本寫死的表單分批改由設計器定義（批次 1：用印申請合約類／非合約類／開立發票；批次 2：出差報告暨旅費報支單；批次 3：費用申請單部門版／部門版_單筆一萬元以下／產品專案版／營收專案版；批次 4：資產異動申請單；批次 5：請購單、採購單、驗收單、費用申請單(採購付款)、費用申請單(免走採購)，五張需依此順序發佈，`npm run forms:migrate -- --batch 5 --publish` 會依序處理）。發佈後舊版的建立路徑關閉，舊單據仍可在原頁面檢視與簽核。定義以既有常數組成，並以單元測試逐項比對新舊驗證與簽核人結果（`migrated/*.test.ts`），切換行為另有整合測試（`tests/integration/legacy-*.test.ts`）；`tests/integration/migrated-forms-designer.test.ts` 確認每張轉換表單都能在設計器中開啟、修改並再次發佈。
- 安裝：`npm run forms:migrate -- --batch <批次>`（預設只連本機資料庫；加 `--dry-run` 只檢查）。預設建立「草稿」，使用者看不到任何改變；管理員在表單設計器用「預覽」「模擬」確認後按「發佈」才切換。`--publish` 直接發佈（已存在的草稿連同設計器中的修改一起發佈）。已存在的代號不會被覆蓋。`start.sh` 會自動建立批次 1–5 草稿。
- 出差報支（批次 2）與舊版的差異：非交通費列不會停用起訖站／里程欄；不顯示預支差額（應補發／應退還）與「依出差期間帶入日期」按鈕；未填預支金額存為空值而非 0；預算來源清單也列出未指定負責人的預算編號（標示「未指定預算負責人」，送出時仍會被擋）；退回後重送若沒有任何簽核人會自動核准（舊版拒絕）。
- 費用申請（批次 3）與舊版的差異：不會自動選申請人部門的預算編號；期望付款日不預填建議日、不顯示收件截止日與「帶入建議付款日」；改選現金／支票時不會自動在匯款資訊填「無」（仍需自行填寫）；預算來源清單同樣列出未指定負責人的預算編號；退回後重送沒有簽核人時自動核准；錯誤訊息文字不同（例：「第 1 列「小計」：單筆不可超過新臺幣 10,000 元…」）。匯款資訊為敏感欄位，簽核人看到的是遮蔽後內容（與舊版相同）。
- 關聯單據欄位（批次 5a 起）：表單可設定「接續」申請人本人、已核准的其他表單，新單併入來源的案件（同一案件每張表單只能建立一次，撤回的也算），並可帶入來源明細（帶入欄位由伺服器依來源重寫，申請人不能修改；可設定全部帶入或可移除部分列）。來源表單需先發佈。核准後的單據明細頁會出現「接續建立…」按鈕。因同一案件可有多張設計器單據，經辦人（`form_submissions.filed_by_employee_id`）改記在每張單據上，讀取與附件權限依各單據自己的申請人／經辦人判斷，不再依案件建立者。明細表新增「預算編號」欄類型，可要求各列同一位預算負責人；流程的「預算負責人」可指向明細的預算編號欄（`明細.欄位`）。
- 請購單／採購單（批次 5a）與舊版的差異：新版採購單只能接續新版請購單（發佈後舊版請購單不能再建立採購單）；請購明細的「項目」不另存，改由預算編號顯示的類別呈現；「材料滿 80,000 應選設備」只以說明文字提示；採購單的預算負責人與部門依送出當下的預算編號負責人與申請人部門判斷（舊版沿用請購單當時的資料）；報價家數未達門檻時顯示通用的「必填」訊息；修改或重新送出時若找不到簽核人，依設計器流程設定處理（舊版一律拒絕）。
- 批次 5b 新增的設計器能力：明細表文字欄可設為「核准後由財會填寫」（申請人填的值一律忽略；單據核准後財會／系統管理員可在明細頁逐格填寫，記錄稽核含原值）；明細表可設定「合計上限」；文字欄新增「銀行帳號」「年月（YYYY-MM）」格式；表單可開啟「付款排程」（指定付款對象 employee／supplier、發票月份、期望付款日欄位，送出時由伺服器補上期望付款日並計算撥款批次，存於單據資料的 `_paymentBatch`，用戶端無法指定）。設計器建立的請購單與免走採購費用申請單所開的案件類型分別為 `standard`／`standalone_expense`，案件總覽與財會簽核追蹤會一併讀取設計器單據（依定義的 `legacy_form_type` 對應到請購／採購／驗收／付款欄位）。
- 驗收單／費用申請單（批次 5b）與舊版的差異：新版驗收單只能接續新版採購單、新版付款只能接續新版驗收單或採購單（發佈後舊版採購單的「建立驗收單／建立費用申請單」改為提示）；付款來源由申請人選擇：已核准的驗收單（只帶入合格項目，可移除部分列）或付款條件為「預付款」且案件尚無核准驗收單的採購單，選錯來源的錯誤代碼為 validation（舊版為 conflict），送出不合格或不屬於來源的明細會被拒絕；驗收與付款的預算負責人依送出當下明細預算編號的負責人判斷（舊版沿用採購單當時的資料）；付款明細頁沿用舊版「期望付款日與採購單付款條件不一致」的提醒（以採購單核准日加付款條件天數比對，容許 3 天）；免走採購費用申請單改為獨立表單（`legacy_form_type = standalone_expense_request`），總金額上限以「合計上限 9,999.99」表示。
- 資產異動（批次 4）與舊版的差異：照片與其他附件合併為同一個附件欄位；表單上不顯示原／新單位主管姓名（簽核進度與模擬可看到）；保管人是否與清冊一致只在送出時由伺服器檢查（舊版畫面會先提示）；申請人本人或重複的簽核人以「系統自動簽核」關卡顯示（舊版直接省略）；總經理未設定或為申請人本人時，簽核進度會出現一個「略過」的總經理關卡；備註「其他」未填時顯示通用的「必填」訊息；財產編號格式錯誤在驗證階段即拒絕（舊版在查清冊時拒絕）。
- 遠端資料庫需同時加 `--allow-remote --actor <啟用中管理員 email>`。
- 切換：表單定義帶有 `legacy_form_type`，發佈後選單、`/forms`、各類別首頁的「新增」改指向 `/f/<代號>/new`，舊版新增頁轉址，舊版建立 API 以衝突拒絕；已送出的舊單照常簽核、修改、重送與查閱。新單存在 `form_submissions`，各類別首頁另列「新版」清單。
- 回復：在設計器「下架」該表單即恢復舊版入口與建立（已送出的新版單仍可簽核）。

### 表單設計器（`/admin/form-builder`，`src/lib/form-builder/`）

- 系統管理員在「管理 → 表單設計器」新增表單（空白或複製既有表單），以拖拉或點選加入欄位、分區與明細表，設定必填、說明、寬度、條件顯示；簽核流程以積木拼成（七種簽核人來源 + 條件式與「其他」），右側可即時模擬簽核人。「預覽」分頁以實際填寫畫面試填（含手機寬度），試送出只做驗證與模擬，不建立資料；有「關聯單據」欄位的表單改用依來源表單明細產生的範例單據（不讀取真實單據），來源條件與「案件已有核准單據」只在正式送出時檢查。
- 欄位與流程的修改先存成草稿，不影響使用中的表單；按「發布」才建立新版本（伺服器重新檢查所有欄位、流程與引用的組織資料）。名稱、說明、分類、字首、可填寫範圍屬於「發布設定」，儲存後立即生效。
- 同一欄位代號在所有已發布版本中類型必須一致（要改類型請用新代號）；已發布欄位的代號鎖定。發布後表單代號不能更改。
- 多人同時編輯以表單的 `version` 樂觀鎖保護：別人先儲存時，後儲存者會收到衝突訊息而不是覆蓋。
- 只能刪除從未發布的表單；已發布的表單只能「下架」（不再出現在選單、不能新送出，已送出的單可照常簽核、修改、重送），可再「重新上架」。
- 權限與組織設定頁相同：系統管理員、1 小時內登入過、每人每 10 分鐘 300 次頻率限制；每次修改在交易內鎖定該表單並重新確認管理員身分，寫入稽核紀錄（設定修改含前後值）。模擬在唯讀交易中執行。
- 尚未支援：選項組管理、財產欄位與財產保管人來源、條件只支援單一「全部符合／任一符合」群組（更複雜的條件以唯讀顯示）、核准後自動動作、欄位改代號時自動更新流程中的引用（發布檢查會擋下失效的引用）。

### 組織與簽核設定（`/admin/org`，`src/lib/admin/org/`）

- 系統管理員維護簽核流程會用到的組織資料：部門樹（上層部門、組織層級、部門主管、排序、停用）、組織層級（數字越大越高）、職務類別與擔任者（全公司或指定部門，每個範圍固定一位「主要」人員）、員工群組（成員依序簽核）、代理人（期間、全部或部分表單、撤銷）。
- 修改需系統管理員且 1 小時內登入過（帳號管理維持 15 分鐘），另有每人每 10 分鐘 300 次的頻率限制；每次修改在交易內以 advisory lock 排隊、重新確認操作者仍是啟用中的管理員，並寫入稽核紀錄（含修改前後值）。
- 已發布表單目前版本、以及簽核中／退回中申請單所用版本的流程，所指定的部門、層級、職務、群組不能被停用、刪除或清空；部門停用前需先移走在職員工與啟用中的下層部門，上層停用時下層不能啟用；部門不能掛到自己或自己的下層。
- 總經理／董事長是系統職務：只能設定為全公司，透過 `employees.is_general_manager`／`is_chairman` 增減（trigger 同步職務綁定），不能移除最後一位在職者；名稱與啟用狀態不能修改。
- 代理只轉一次：同一被代理人的代理期間與表單範圍不能重疊，代理人在同期間不能也設定代理，正在代理別人的人也不能同時請人代理。代理在產生簽核關卡時套用，已在等待的關卡不改派；舊版內建表單轉換成新流程前不受代理影響。
- 「流程模擬」以目前組織資料試算已發布表單的簽核人（可指定申請人、日期與流程會參考的欄位），在唯讀交易中執行，不建立任何資料。

### 附件

- 以附件 ID 下載（`/api/attachments/<id>`），每次重新檢查授權；一律以下載方式回應（`Content-Disposition: attachment`、`nosniff`、`CSP sandbox`）。
- 只接受 PDF／PNG／JPEG，**以檔案內容判斷**（副檔名與瀏覽器 MIME 不採信）；單檔 10 MB、每張表單 20 個（同一張表單同時上傳時以資料庫鎖確保不超過上限）。
- 申請人／經辦人只能在「還沒有人核准」或「被退回修改」時上傳附件；一旦有人核准，就不能再補附件改變已簽核的內容（finance／admin 不受此限）。上傳時會鎖定表單並重新檢查，且表單版本加 1：上傳前就開著頁面的簽核人必須重新整理、看過新附件後才能核准。
- 儲存路徑由伺服器產生（UUID），原檔名只作顯示；讀檔限制在儲存根目錄內且不跟隨 symlink，寫檔不覆蓋既有檔案。
- 掃描：`ATTACHMENT_SCAN=clamav` 時每個上傳檔先放隔離區，由本機 clamd 掃描（檔案不送外部），通過才搬到正式位置。掃描失敗或逾時不會標為安全，保留在隔離區，由 `npm run attachments:rescan` 重試；中毒檔直接刪除。正式環境沒有掃描器會拒絕上傳；開發環境可 `ATTACHMENT_SCAN=disabled`（標記為「未掃描」，正式環境不提供下載）。
- 儲存目錄不在 `public/`，也不應由 reverse proxy 直接對外提供。
- `public/` 的檔案不經過資料庫 session 檢查（`src/proxy.ts` 只看有沒有 cookie），只能放公開的靜態資源。內部參考文件放 `assets/docs/`，由 `src/app/docs/[file]/route.ts` 依允許清單、登入後才提供。

### 瀏覽器安全標頭

每個回應都有 CSP（script 使用每次請求的 nonce，不用 `unsafe-inline`／`unsafe-eval`；style 允許 inline）、`frame-ancestors 'none'`、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`。HSTS 需在 HTTPS 與正式網域確認後以 `ENABLE_HSTS=true` 開啟。PDF 工具完全在瀏覽器執行，限制 30 MB、100 頁，停用 eval，不抓取外部資源。預算 Excel 匯入限制 5 MB、5000 列，並在交給 exceljs 前實際解壓每個項目、以上限截斷，宣告大小與實際不符、加密或不支援的壓縮方式一律拒絕（防 zip bomb）。附件下載的 CSP 為 `default-src 'none'; sandbox`，不會被一般頁面的 CSP 覆蓋。正式環境（`APP_ORIGIN` 為 https）只接受 `__Host-accsys_sid` cookie。

## 專案結構

```
src/
  app/                    Next.js App Router 頁面與 Server Components
  lib/
    <domain>/actions.ts   Server Actions（服務端角色驗證後寫入 Postgres）
    <domain>/queries.ts   讀取查詢
    <domain>/validate.ts  純函式輸入驗證
    approval/             簽核鏈建構邏輯
    auth/                 Google OAuth、session、角色、白名單網域
    db/                   Postgres client（Drizzle schema + 查詢層）
    attachments/          附件上傳、掃描與授權下載（主機持久目錄）
drizzle/                  版控 SQL migrations（由 src/lib/db/schema.ts 產生並人工審查）
db/
  roles.sql               資料庫角色與權限（DBA 執行）
  baseline-fingerprint.json  既有資料庫接管時比對用的結構指紋
  legacy/schema-v0.sql    導入 migrations 前的建表腳本（僅歷史／演練，勿再使用）
  seed-local-dev.sql      本機 dev 登入種子（勿用於正式環境）
  README.md               角色、migration 流程、接管既有 DB、敏感資料規則
scripts/                  一次性資料匯入腳本（import-seed-data.ts 等）
tests/integration/        資料庫整合測試（只連拋棄式 TEST_DATABASE_URL，見「執行測試」）
docs/superpowers/         各階段開發計畫（specs／plans）與交接文件
```

## 環境需求

- Node.js 24 LTS（版本固定於 `.nvmrc`：`nvm install && nvm use`）；Node 20 已於 2026-04-30 停止支援
- npm（以 `package-lock.json` 為準，安裝一律 `npm ci`）
- Docker（本機 Postgres、整合測試 DB、app 容器）

### 環境變數（`.env.local`）

完整範本與說明見 `.env.local.example`。主要項目：

```bash
DATABASE_URL=postgres://accsys_app:...@127.0.0.1:15432/accsys   # 最小權限帳號
MIGRATION_DATABASE_URL=postgres://accsys_migrator:...@...        # 只給 db:migrate
SESSION_SECRET=                      # 至少 32 字元
APP_ORIGIN=http://localhost:3001     # 固定網址；正式環境必須 https
AUTH_MODE=manual
ALLOWED_GOOGLE_DOMAINS=turing-drive.com
SESSION_TTL_HOURS=8
STORAGE_LOCAL_PATH=./data/attachments
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# 本機略過 Google：只在 `next dev`、旗標為 true 且 APP_ORIGIN 為 localhost／127.0.0.1 時生效；
# build／容器一律 404，共享環境勿開
DEV_LOGIN_EMAIL=
NEXT_PUBLIC_DEV_LOGIN=false
# Email 通知（目前程式碼已支援，尚未正式啟用寄送）
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

`.env.local` 內含真實憑證，**絕不可提交到版本控制**。

## 開始使用

最簡單的方式是在專案根目錄執行：

```bash
./start.sh             # 開 Docker Desktop → Postgres → 角色／migrations／dev 種子 → Next.js（前台與後台 API），就緒後自動開瀏覽器
./start.sh --seed      # 同上，並匯入示範假資料
./start.sh --port 3005 # 指定 port（預設 3001）
./start.sh --no-open   # 不自動開瀏覽器
./start.sh --stop      # 關閉本專案的 Next.js 與資料庫容器（資料保留在 volume）
```

重複執行會先關掉本專案先前啟動的 Next.js／啟動腳本（只認工作目錄在本專案內的程序），再重新啟動；資料庫容器若卡在 unhealthy 會自動重啟。port 被其他程式占用時不會關掉它，而是往後找空的 port，並以環境變數覆寫 `APP_ORIGIN` 讓登入可用。`.env.local` 不存在時會從範本建立（隨機 `SESSION_SECRET`、開啟 dev 登入）。

手動步驟：

```bash
cp .env.local.example .env.local
# 編輯 SESSION_SECRET（至少 32 字元）；本機可設 NEXT_PUBLIC_DEV_LOGIN=true 與 DEV_LOGIN_EMAIL

npm install
npm run dev:all        # 啟動本機 Postgres、建立角色、套用 migrations、載入 dev 種子，再啟動 Next.js
npm run seed           # 選用：匯入部門／員工／預算編號／供應商
```

既有的本機 DB（P1 前建立）第一次跑 `npm run dev:all` 時會自動建立角色、核對結構後登記 baseline，再套用新 migrations；結構不符會停下並列出差異，不會修改資料。之後請把 `.env.local` 的 `DATABASE_URL` 改為最小權限的 `accsys_app`（見 `.env.local.example`）。

開啟 http://localhost:3000，未登入會自動導向 `/login`。`npm run dev`／`npm run start` 只綁定 127.0.0.1；需讓其他電腦連線時，應經 reverse proxy 與 HTTPS，不要直接改成 0.0.0.0。本機可開開發登入；正式環境用公司 Google 帳號登入後導向 `/dashboard`。

## 開發指令

```bash
npm run db:up    # 啟動本機 Postgres
npm run db:down  # 停止本機 Postgres
npm run dev      # 啟動開發伺服器
npm run build    # 產生正式環境建置
npm run start    # 啟動已建置的正式環境伺服器
npm run lint        # ESLint 檢查
npm run typecheck   # TypeScript（應用程式 + 測試）
npm test            # 單元測試（= test:unit，不連 DB）
npm run test:watch  # 監看模式
npm run check       # lint + typecheck + 單元測試 + production build
npm run app:up      # 以 Docker 啟動 Postgres + app 容器（http://127.0.0.1:3000）
```

### 依賴與基底映像

- 安裝一律 `npm ci`（`scripts/start-dev.sh` 也是）。npm 11 預設不執行未核准的 install script；目前 esbuild／unrs-resolver 的 postinstall 未核准，不影響建置與測試。
- CI 對正式依賴執行 `npm audit --omit=dev --audit-level=high`，有 high／critical 即失敗。開發／建置工具的告警逐項判斷，不使用 `npm audit fix --force`。
- Next 依賴的 postcss 以 `overrides` 統一為專案版本（8.5.x）。
- 目前已判斷不影響執行環境、暫不處理的告警：Tailwind 3 與 eslint-config-next 底下的 `braces` 3.0.3（GHSA-vfj7-8cjw-p6xm，尚無修補版；只在建置／lint 時展開設定檔裡的固定 glob，不接觸使用者輸入；修正需升級 Tailwind 4）、drizzle-kit 底下的 esbuild（開發工具）、exceljs 依賴的 uuid（只用 v4，告警在 v3/v5/v6）。
- Node 基底映像與 PostgreSQL 映像以 digest 固定（`Dockerfile`、`docker-compose*.yml`、CI）。更新方式：查官方映像同 tag 的新 digest（例如 `docker buildx imagetools inspect node:24.21.0-bookworm-slim`），四處一起替換後重跑 CI 與容器冒煙測試。
- 字型（Inter、Noto Sans TC）由 `@fontsource` 套件隨 lockfile 打包，build 與執行時都不連 Google Fonts；Docker build 只需要 npm registry。
- 支援期限（2026-10 查核）：Node 24 維護到 2028-04；PostgreSQL 16 到 2028-11；Next.js 已升級 16.4（15 的維護期到 2026-10-21 結束）。Next 16 的 request 攔截檔為 `src/proxy.ts`（原 `middleware.ts`，改在 Node runtime 執行）。

### 執行測試

- **單元測試**（`npm test`）：不連資料庫、不讀 `.env.local`。
- **整合測試**（`npm run test:integration`）：只允許 `TEST_DATABASE_URL`，且資料庫名稱必須以 `_test` 結尾；未設定時整批失敗，不會略過，也不會改用 `DATABASE_URL`。
  - 業務測試以最小權限的 `accsys_app` 連線，確認 app 不需要 DDL／超級使用者權限。
  - `migrations.test.ts` 以 `TEST_ADMIN_DATABASE_URL`（只允許本機、`_test`）建立暫存資料庫，演練：空庫升級、舊腳本建立的有資料副本接管升級（ID／筆數／金額／外鍵不變）、重跑 no-op、兩個 migrator 併發、已套用檔案被改、結構漂移、各角色權限。

```bash
npm run test:db:up     # 拋棄式 Postgres（tmpfs，127.0.0.1:25432）：建立角色 → 真實 migrations → 假資料
TEST_DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
TEST_ADMIN_DATABASE_URL=postgres://accsys_test:accsys_test@127.0.0.1:25432/accsys_test \
  npm run test:integration
npm run test:db:down   # 刪除容器與資料
```

舊 Supabase RLS 測試（`tests/integration/*-rls.test.ts`）依賴已移除的 Supabase Auth／RLS，無法執行，已列於 `vitest.integration.config.ts` 的 `LEGACY_SUPABASE_RLS_TESTS` 並排除於 typecheck。它們**不算通過**，替代測試如下：

| 舊測試 | 原本驗證 | 替代（應用層授權測試） |
|---|---|---|
| master-data-rls | 員工可讀部門；staff 不可新增部門；admin 可新增／刪除 | P3：主檔 query／action 角色正負測試 |
| procurement-rls | 申請人、指定簽核人可讀請購單，無關員工不可；簽核人可讀全部步驟；前端不可直接寫入；收件人只能讀／標記自己的通知 | P3：請購 query／action 逐案授權與通知授權測試；P4：簽核交易內 actor 檢查。「前端不可直接寫 DB」改由 DB 不對瀏覽器開放 + P1 runtime 最小權限保證 |
| new-forms-rls | 採購／驗收／費用單及附件只給申請人、簽核人、finance；明細隨表頭授權；未授權者不可下載附件 | P3：三種表單、明細與附件 ID 授權測試（含直接 URL、他人附件 ID） |
| projects-rls | 員工可讀專案；staff 不可新增；admin 可新增／刪除 | P3：projects action 角色正負測試（`projects-actions.test.ts` 已部分涵蓋） |

替代測試完成後（P5）才刪除舊檔。

## 登入與帳號

- **協定**：Google OIDC Authorization Code + PKCE（S256）。每次登入產生獨立 state／nonce／verifier，10 分鐘內有效、只能用一次（伺服器端記錄 state 雜湊）；callback 無論成功或失敗都清除登入交易 cookie。
- **驗證**：ID token 簽章（JWKS）、issuer、audience、exp、nonce；`email_verified` 必須為 `true`；`hd` 與 email 網域都必須在 `ALLOWED_GOOGLE_DOMAINS`。授權網址裡的 `hd` 只是提示。
- **身分**：以 issuer + `sub` 對應員工（`employee_identities`），email 只是屬性。同一個 Google 帳號改 email 仍是同一位員工；不同 Google 帳號使用相同 email 會被拒絕並標記衝突。
- **綁定**：未綁定的帳號登入時只會建立申請（`identity_link_requests`），由管理員在 `/admin/accounts` 核准到指定員工；**不會**依 email 自動綁定，公司網域登入也不會自動取得權限。
- **Session**：cookie 只放隨機 token（`__Host-accsys_sid`，HttpOnly、Secure、SameSite=Lax），資料庫只存 SHA-256。絕對壽命預設 8 小時、不自動續期。每個請求都重新檢查 session、員工停用狀態、綁定狀態與目前角色；登出（POST）、停用、撤銷綁定立即失效。舊版只有 email 的 `accsys_session` cookie 一律丟棄。
- **CSRF／轉址**：Server Actions 使用 Next 內建來源檢查；登出等 route handler 要求 `Origin` 等於 `APP_ORIGIN`。所有轉址都用 `APP_ORIGIN`，不信任 Host／X-Forwarded-Host；`returnTo` 只接受站內路徑。
- **限速**：登入開始與 callback 依 `TRUSTED_CLIENT_IP_HEADER` 每 10 分鐘 30 次；管理操作每人每 10 分鐘 60 次（PostgreSQL 共用計數，固定視窗到期自動解除，不會永久鎖帳號）。
- **模式**：目前只支援 `AUTH_MODE=manual`；設定成 `directory` 會拒絕啟動登入，不會降級放行。
- **Workspace 目錄同步（P6，第一階段）**：`src/lib/directory/` 解析 Directory `users.list`（逐頁驗證網域／customer、重複 ID、重複分頁 token、429／5xx 重試、401／403 立即停止；任何一頁失敗就整批放棄，不用部分名單）並產生同步計畫：只撤銷 suspended／archived 帳號的綁定與 session、email 跟隨目錄；名單中缺少的已綁定帳號與未綁定帳號只列入報告。名單為空、啟用人數比上次少 20% 以上、撤銷數超過 max(5, 10%) 時拒絕套用並寫 audit。同步不會恢復被停權或本地停用的帳號，也不改 `employees.access_enabled`。目前只能以 fixture dry-run：
  ```bash
  DATABASE_URL=... ALLOWED_GOOGLE_DOMAINS=example.com npm run directory:dry-run -- --fixture tests/fixtures/directory/users-pages.json
  ```
  `--apply` 與 `AUTH_MODE=directory` 需公司核准唯讀同步帳號（`admin.directory.user.readonly`）、接上正式資料來源並在測試 tenant 驗收後才開放。

### 第一位管理員（一次性 bootstrap）

1. 確認該員工在 `employees` 的角色為 `admin`。
2. 本人用 Google 登入，畫面顯示「等待管理員核准」。
3. 在伺服器 shell（不是網頁）執行：
   ```bash
   DATABASE_URL=postgres://accsys_app:***@HOST/accsys npm run auth:bootstrap -- --list
   DATABASE_URL=postgres://accsys_app:***@HOST/accsys npm run auth:bootstrap -- --request <申請 id> --employee <員工代碼>
   ```
4. 只要已有任何啟用中的 admin 綁定，這個命令就會拒絕；之後一律在 `/admin/accounts` 核准。

### 真實 Google 登入驗收（需公司授權，尚未執行）

自動化測試使用本機假 OIDC provider；以下需公司 Google Workspace 管理者配合：

1. 公司 Google API 專案建立 OAuth Client（Web application），已授權重新導向 URI 完全等於 `https://<正式 FQDN>/auth/callback`（測試環境另一組 client）。只需 `openid email profile`。
2. 用測試帳號確認：正常登入、非公司網域帳號被拒、未綁定帳號進入待核准、核准後可登入、停用後立即登出、登出後返回上一頁不能再操作。
3. 確認 Google 回傳 ID token 的 `iss` 為 `https://accounts.google.com`（程式嚴格比對 discovery 的 issuer）。
4. 確認主機可 outbound HTTPS 到 `accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`（JWKS），DNS 與時間同步正常。

## 資料庫

完整說明見 **[db/README.md](db/README.md)**。

- **結構定義**：`src/lib/db/schema.ts`（Drizzle）→ `npm run db:generate` 產生 `drizzle/` SQL → 審查
- **套用**：`npm run db:migrate`（獨立命令，使用 `MIGRATION_DATABASE_URL` / `accsys_migrator`；web 啟動不會自動跑）
- **既有資料庫**：`npm run db:baseline` 核對結構後接管，再 `db:migrate`
- **角色**：`db/roles.sql`；web 只用 `accsys_app`（無 DDL、無超級使用者）
- **容器**：`npm run app:migrate`（一次性 migration job），再 `npm run app:up`
- **示範資料**：`npm run seed:demo`；正式主檔：`npm run seed`（Excel）

授權在應用層檢查，不使用 RLS；資料庫以角色權限限制 app 帳號能做的事。

## 地端正式部署

`docker-compose.yml`／`docker-compose.app.yml` 只供本機開發。正式環境使用 `deploy/`：

| 檔案 | 用途 |
|---|---|
| `deploy/compose.prod.yml` | nginx → app → PostgreSQL（DB 只在 internal 網路、無 published port）、ClamAV（只在獨立的 internal `scan` 網路與病毒碼更新用的對外網路，碰不到 DB）；一次性 `migrate`／`admin-cli`／`backup`。所有 ACCSYS 容器以專用 uid／gid `10001`（`ACCSYS_UID`／`ACCSYS_GID`）執行，避免與主機第一個登入帳號（常為 1000）共用檔案權限 |
| `deploy/nginx/templates/accsys.conf.template` | TLS、未知 Host／SNI 拒絕、覆寫 forwarded headers、log 不記 query string |
| `deploy/accsys.env.example` | 非機密設定；機密一律以檔案掛載（`*_FILE`，`src/lib/secret-files.ts`） |
| `deploy/backup/backup.sh`、`restore-drill.sh` | 每日 logical 備份（DB + 附件 + SHA256SUMS）與拋棄式還原演練 |
| `deploy/systemd/` | 備份 timer |

操作手冊：[部署](docs/operations/deployment.md)、[備份與還原](docs/operations/backup-restore.md)、[資安事件與金鑰輪替](docs/operations/incident-response.md)。

## 開發歷程

本專案採用分階段規劃與 AI 輔助的 subagent-driven 開發流程實作，各階段的設計文件與實作計畫收錄於 `docs/superpowers/`：

1. **地基篇 + 請購單／簽核引擎篇** — 專案骨架、Google OAuth 登入、主檔資料、請購單與簽核鏈
2. **採購單／驗收單／費用申請單 + 附件與 Email 通知篇** — 其餘三張表單、附件上傳、案件總覽頁、Email 通知（程式就緒未啟用）
3. **工作流程清理篇** — 死路徑修正、登入錯誤訊息、共用表單型別模組、ESLint 修復、台灣時區案號、CAS 併發保護、憑證待補提醒、專案型預算編號支援
4. **預算編號基礎資料管理** — 財會可透過網頁手動維護或 Excel 批次匯入預算編號
5. **財會簽核追蹤頁** — `/case-tracking`，財會人員可依部門／日期／關鍵字篩選，追蹤全公司所有案件的簽核狀態（簽核中／已完成兩個頁籤）
6. **預算後台強化與工作流程彈性** — 新增獨立 `projects` 主檔（取代原本 `budget_codes.project_code` 純文字欄位）、`/budget-codes` 支援專案下拉選單與專案管理區塊；新增金額低於 NT$10,000 可免走採購流程的獨立費用申請單；四張表單新增「送出後、第一關審核前可自行修改或撤回」能力；`/case-tracking` 新增「已撤回」頁籤；`admin` 角色開放存取 `/budget-codes`、`/case-tracking`

尚未規劃的較大範圍功能，留待後續獨立規劃，不在目前範圍內：

- 年度預算按月編列、預算新增／變更申請書、預算執行追蹤與超支警示
- 簽核追蹤頁的報表匯出（給記帳士/會計師事務所）
- **既有內建表單改用設計器流程**：請購、採購、驗收、費用、差旅、用印等內建表單仍使用寫死的簽核鏈，尚未轉換為可在設計器調整的流程。

## 已知限制

- Email／SMTP 尚未正式啟用寄送（程式邏輯已完成，缺少環境變數時會靜默略過，不影響簽核流程本身）。
- 專案型預算編號若未指定負責人，需在資料庫手動指定 `owner_employee_id`，否則無法用於建立請購單。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——之後可考慮把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 地端部署設定與手冊已備妥（`deploy/`、`docs/operations/`），尚未在公司主機實際部署；真實 HTTPS 憑證、Google 登入與異機備份需公司主機與授權。
- 目前備份為每日 logical dump（RPO 約 24 小時）；WAL／PITR（pgBackRest）需在目標主機驗證後啟用。
- 若主機上已有以 uid 1000 建立的 `ACCSYS_DATA_DIR`／`ACCSYS_BACKUP_DIR`，改用 uid 10001 前需依[部署手冊](docs/operations/deployment.md)建立系統帳號並 `chown`。
- ClamAV 容器仍需對外連線更新病毒碼；clamd 尚未設定 `AlertExceedsMax`，超過掃描上限的檔案目前依 clamd 預設處理。
- 登入／API 速率限制依 `TRUSTED_CLIENT_IP_HEADER` 取得用戶端 IP；若未設定（正式 compose 已設定），所有請求共用同一個額度。
- 核准／退回動作對不存在與無權限的表單 ID 回應略有不同，理論上可推測 UUID 是否存在（UUID 不可猜，風險低）。
- **簽核流程規則（待以表單／簽核組織機制統一處理，見 `docs/superpowers/specs/2026-10-13-form-builder-and-approval-org-design.md`）**：
  - 申請人同時是自己的部門主管、預算負責人與總經理且金額 ≤ NT$100,000 時，簽核鏈為空，表單建立即自動核准。
  - 合約用印單的金額由申請人填寫（可為 0），董事長是否簽核依此金額判斷。
  - 由採購單建立的費用申請單，付款對象不強制等於採購單廠商；簽核人只看到帳號末 4 碼。
  - 預算編號未檢查年度、所屬部門與剩餘預算；單筆上限可拆單規避；採購單金額不受請購核准金額限制；差旅與報銷沒有重複請款偵測；後續表單沿用請購時的預算負責人。
- 案件追蹤查詢沒有分頁，案件數極大時會變慢；session 沒有閒置逾時（最長 `SESSION_TTL_HOURS`），共用電腦請登出；Workspace 停權帳號需由管理員手動停用（`directory-sync --apply` 尚未啟用）。
