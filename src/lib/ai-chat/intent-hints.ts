/** Server-only hints injected before the model sees the user turn. */
export function intentHintsForUserMessage(message: string): string[] {
  const hints: string[] = [];
  if (
    /刪除?\s*全部\s*附件|全部\s*附件\s*(刪除?|清掉?|移除)|清掉?\s*(全部)?附件|移除\s*全部\s*附件|附件\s*全部\s*(刪|清|移除)|把\s*全部\s*附件/.test(
      message,
    )
  ) {
    hints.push(
      '【系統意圖提示】使用者要求刪除／清除本草稿全部附件。必須呼叫 remove_draft_attachments（remove_all=true、帶 draft_id 與 expected_version）。禁止回覆無法透過對話刪除或叫使用者去右側垃圾桶。',
    );
  } else if (/刪除?\s*附件|移除\s*附件|拿掉\s*附件/.test(message)) {
    hints.push(
      '【系統意圖提示】使用者要移除草稿附件。先 list_draft_attachments；再 remove_draft_attachments（file_ids 或 remove_all）。禁止說系統不支援對話刪除。',
    );
  }
  if (/同行|一起出差|有沒有人.*出差|誰.*一起/.test(message)) {
    hints.push(
      '【系統意圖提示】使用者在問同行者。必須先呼叫 search_trip_companion_candidates（draft_id）；不可因本人公出單或草稿已填「無」就斷言沒有其他人。',
    );
  }
  if (/轉給|轉移|移交|過戶|資產異動|設備異動|保管人異動|資產借出|資產報廢|設備報廢/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求將資產／設備轉移給他人或辦理資產異動（保管人異動、借出、合併、出售、報廢、其他）。',
        '請直接建立或更新「資產異動申請單」（form_key="asset-transfer"），無須再問使用者是不是要填資產異動單，直接幫他開好草稿並打開右側面板！',
        'asset-transfer 欄位規格：',
        '- transferTypes（異動說明，複選）：填 ["保管人異動"] 或 ["借出"]、["合併"]、["出售"]、["報廢"]',
        '- originalCustodianEmployeeId（原保管人）：填當前登入員工姓名',
        '- newCustodianEmployeeId（新保管人）：填目標接收員工姓名（如 @標註的員工；若報廢或借出未變更保管人則填原保管人）',
        '- useDepartmentId（使用部門）：填新保管人所屬部門名稱',
        '- useBudgetCodeId（使用專案/客戶名稱）：若有已知預算代碼可填，若未知可留空待使用者補充',
        '- items（財產明細表格，用 rows: [{ op: "add", table: "items", cells: [...] }]）：',
        '  欄位包含 assetId（財產編號或設備名稱，如 TD-IT-0054-01）、reason（填異動說明對應文字）、newCustodianEmployeeId（填新保管人姓名）、newLocation（新保管地點）。',
      ].join('\n'),
    );
  }
  if (/財產清點|清點單|點交單|盤點單|點交確認|同意現在位置|更改.*位置|存在事實/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求處理「財產清點／點交確認系統表單」（/assets/inventory-forms）：',
        '1. 若使用者要查詢目前的財產清點／點交單：請呼叫 `list_inventory_handover_forms`。',
        '2. 若清點人（財會／總務／管理員）要於指定時間發送「財產清點／點交系統表單」給財產擁有者（保管人）：請呼叫 `dispatch_inventory_handover_form`（帶入 custodian 保管人姓名或工號、scheduled_at 指定點交時間、meeting_location 點交地點、instructions 說明）。',
        '3. 若財產擁有者或清點人要在系統表單上點選確認「同意現在位置」或「需要更改異動（填新位置）」以及「確認此物品之存在事實及其他說明」：請呼叫 `confirm_inventory_handover_items`（帶入 party="custodian" 或 "inspector"、location_action="agree_current" 或 "change_needed"、confirmed_location、existence_fact、note；若雙方每一條都確認後要結束表單，設 complete_if_ready=true）。',
      ].join('\n'),
    );
  }
  if (/我的待辦|待辦事項|有幾件事|還有多少事項|待處理事項/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者在詢問「我的待辦」各子項目的待處理數量與摘要：',
        '請呼叫 `get_my_pending_tasks_overview`，回報「簽核與單據追蹤」、「年度預算表填報」與「我的資產管理（財產清點單）」各自的待處理筆數與對應連結。',
      ].join('\n'),
    );
  }
  if (/歷年預算|舊的預算|以前填過.*預算|派發預算|發預算填寫單|收到.*預算|待填預算|預算指標|預算規模|成長率|涵蓋率|治理檢核|0元.*科目|未指派負責人/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者詢問年度預算派發任務、歷年填寫紀錄或財會單一年度預算決策指標：',
        '1. 若查詢本人收到的「財會派發待填預算單（如 BUDGET-116）」、「即時自動儲存中的預算表草稿」或「歷年（115、114 年度）已填寫預算紀錄與差異分析」：請呼叫 `list_my_budget_tasks_and_history`（若使用者想接著填寫草稿，設 `open_draft=true` 直接在右側彈出 116 年度預算表草稿）。',
        '2. 若使用者要求「請財會人員派發年度預算填寫單給我的帳號（或指定員工）」：請呼叫 `dispatch_budget_compilation_notice`（`recipient="self"` 或員工姓名，`fiscal_year="116"`，`scope="both"`）。',
        '3. 若財會或管理層詢問「單一年度預算總額、與去年 YoY 比較、部門與專案預算佔比與涵蓋率、動支單據數、0 元待補額度或未指派負責人科目數」：請呼叫 `get_budget_analytics_summary`。',
      ].join('\n'),
    );
  }
  if (/預算申請|編列預算|新增預算|預算變更|追加預算|追減預算|預算流用/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求辦理預算線上簽核（第 1 條 e 化）：',
        '1. 新增或年度預算編列：直接呼叫 create_application_draft 建立「預算申請單」（form_key="budget-request"），欄位含 fiscalYear（如 "115"）、budgetScope（"部門預算" 或 "專案預算"）、targetDepartmentId（部門名稱）或 targetProjectId（專案名稱）、ownerEmployeeId（預算負責人姓名）、reason（申請原因說明）、items 明細列（budgetCode、category、description、requestedAmount）。',
        '2. 既有預算追加／追減／流用：直接呼叫 create_application_draft 建立「預算變更／追加申請單」（form_key="budget-change"），欄位含 changeType（"追加預算（調增）"、"追減預算（調減）" 或 "預算流用／變更"）、reason（變更原因說明）、items 明細列（budgetCodeId 預算編號、originalAmount 原核定金額、newAmount 變更後金額、changeDelta 增減差額、itemNote 項目說明）。',
      ].join('\n'),
    );
  }
  if (/費用申請|費用報支|開.*報支|開.*請購|請購單|採購單|驗收單|採購付款|預付款/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求辦理費用申請或請採驗付流程（第 13、15、16、17 條）：',
        '1. 五合一通用《費用申請單》（form_key="expense-claim"）：適用於所有日常營業費用，以及單筆新臺幣 30,000 元（三萬元）以下之小額採購／購置（設備、材料、軟體、辦公用品、雜項購置等）。欄位含 budgetCodeId（兩層預算來源代碼）、items 明細列（category、description、quantity、currency、amount）、payeeType（"員工本人（申請人）" 或 "廠商"）、expectedPaymentDate、paymentMethod、remittanceInfo。',
        '2. 三萬元門檻提醒：若使用者購買設備／材料／軟體／辦公用品／雜項購置且單筆金額超過新臺幣 30,000 元（三萬元），依公司規定須走採購流程，請建立「請購單」（form_key="purchase-request"，欄位含 neededWithinDays 與 items[budgetCodeId, description, quantity, unitPrice]），或在回覆中明確提示超過三萬元須先開立「1. 請購單 → 2. 採購單」。',
        '3. 採購後續單據：採購單 form_key="purchase-order"（支援 paymentTerms="預付款" 預付流程，以及一張請購單分批開多張採購單）、驗收單 form_key="acceptance"、採購付款單 form_key="procurement-payment"（預付款可於採購單核准後直接先開立採購付款單，到貨後再補驗收單）。',
      ].join('\n'),
    );
  }
  if (/用印|蓋章|大小章|合約章|發票章/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求辦理用印申請（第 38 條：用印申請皆簽至董事長）：',
        '- 合約、協議書、NDA、MOU、意向書用印：請建立 form_key="contract-seal"（用印申請單(合約類)）。',
        '- 一般公文、證明書、非合約文件用印：請建立 form_key="general-seal"（用印申請單(非合約類)）。',
        '- 開立發票用印：請建立 form_key="invoice-seal"（用印申請單(開立發票)）。',
      ].join('\n'),
    );
  }
  return hints;
}
