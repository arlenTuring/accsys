# 技術債清單 — 採購單／驗收單／費用申請單 + 附件與 Email 通知篇

彙整自 29 個任務執行過程中各任務審查發現的 Minor 級發現，以及計畫本身列出的已知限制。無一項會擋住合併，但列出供之後排序處理。

## 本計畫新增的技術債

1. **`tests/integration/expense-requests-schema.test.ts`（Task 3）**：新增的 6 個獨立 CHECK 約束測試中夾雜了敘述性註解（違反專案「無註解」慣例）、重複的 `procurement_case` fixture 建置邏輯（可抽成 helper）、清理邏輯只在 happy path 執行（若前面的 `expect()` 拋出會漏收 fixture）、以及一個與既有測試重複的 `amount <= 0` 測試（test 9，可考慮移除）。
2. **`updateAcceptanceItemPropertyTag`（Task 20）沒有狀態限制**：財會可以在驗收單仍在簽核中或已被退回時就填寫財產編號，與 Task 21 設計註記「財產編號只會在核准後才填寫」的假設不符——目前只是慣例，程式碼並未強制。若這點在實務上重要，需要另外補上狀態檢查。
3. **`computePaymentBatchDate`／`checkPaymentTermsConsistency` 的 `??` 對空字串 `''` 的處理**：函式簽章是 `string | null`，呼叫端（Task 22/26 的表單）必須自行把「已清空的日期欄位」正規化成 `null` 而非 `''` 再呼叫，否則會產生 `Invalid Date` 並往下游擴散。已確認 Task 22/26 的表單元件有做這個正規化，但這是個容易在未來新增呼叫點時踩到的隱性契約。
4. **`.maybeSingle()`／`.single()` 呼叫普遍未檢查 `error`（Task 23 審查發現，其實是既有慣例）**：只解構 `data`，若真的發生資料庫層級錯誤（非「查無資料」），會被誤判為「找不到」而回傳一般化的錯誤訊息，不利除錯。這不是本計畫新增的模式，是延續 Task 2 就已經存在的寫法，但範圍隨著三張新表單擴大了三倍。
5. **三個新表單各自的 `getMy*ApprovalQueue()` 一度處於「已寫但未使用」狀態（Task 18/22/26 → Task 27 才接上）**：Task 27 已經把全部四個接上 `/approvals` 頁面，此項目已解決，僅記錄以說明任務順序上的暫時性 gap。
6. **表單型別 → 路由／資料表對照表重複散落在 4 個檔案**（最終整體審查發現，單一任務的 diff 看不出來）：`attachments/actions.ts` 的 `FORM_ROUTE_PREFIX`／`FORM_TABLE`、`notifications/page.tsx`、`approvals/page.tsx`、`cases/[caseNumber]/page.tsx` 各自定義一份幾乎相同的對照表。之後若要新增第五張表單，需要同步改四個地方；建議抽成共用常數。同理，「誰是表單參與者」的判斷邏輯也有兩份：SQL 的 `is_participant_of_form()` 與 `attachments/actions.ts` 裡的 `isFormParticipant()`（因為 service-role client 會繞過 RLS，所以這份程式碼複製是必要的，但兩邊未來若邏輯變動需要同步修改）。

## 本計畫刻意不實作、與設計文件範圍有落差之處（已在計畫 Global Constraints／Task 29 中明列）

7. **「憑證待補」標記與提醒機制未實作**：設計文件的「錯誤處理與例外情境」段落要求，附件缺件時系統應標記「憑證待補」、在案件頁提醒、並在財會撥款前提示逾期未補件。本計畫沒有擋單邏輯（本來就沒有任何附件必填檢查），但也沒有加上這個標記／提醒機制。若需要，後續應在 `procurement_cases` 或案件總覽頁補上一個 `is_documentation_complete` 類似欄位與提醒橫幅。
8. **上線前帳號治理清單**（設計文件明文列為強制項目）：正式收真實員工／供應商財務資料前，需要有權限的人完成 (1) 建立公司名義的 Supabase Organization 並轉移專案、(2) Vercel 專案改用公司 Team 帳號、(3) 兩邊帳單改公司發票並限制存取權限。這是帳號與帳務操作，不是程式碼變更，本次執行沒有嘗試代為執行。

## 延續自前兩份計畫、本計畫沒有處理的既有技術債

（原樣列在 `docs/superpowers/HANDOFF-plan3.md`，本計畫沒有主動處理，但也沒有讓情況變得更糟）

- 108 筆專案型預算編號尚未匯入
- `npm run lint` 目前無法執行（缺 `eslint.config.js`）——本計畫執行過程中多次確認這個問題依然存在，且與本計畫變更無關
- `/login` 尚未把 `?error=` 顯示給使用者
- 請購單重送（resubmit）僅有 server action + 整合測試，尚無 in-app UI 入口（**注意**：本計畫的三張新表單則都有補上重送的 UI 入口，只有最早的請購單缺）
- 所有簽核動作（現在共 12 個 approve/return server actions，橫跨四張表單）都沒有 CAS（compare-and-swap）保護，同一人連點兩次可能產生重複通知或重複扣款申請——這點在四張表單間是一致的既有模式，本計畫延續而非新增
- 案件單號／申請日期以 DB session 時區（UTC）計算，月份交界的台灣本地時間可能有 off-by-one

## 驗證環境限制（非程式碼問題）

- 這個 worktree 沒有自己的 `.claude/launch.json`，而主專案根目錄的 `.claude/launch.json` 殘留了舊的 `procurement-foundation` worktree 路徑（上一份計畫執行完留下的），導致預覽工具（`preview_start`）一度把 dev server 起在錯誤的目錄、所有新頁面回應 404。已在該 worktree 補上正確的 `.claude/launch.json`（未加入版控，屬本機開發設定），但瀏覽器互動式 QA（計畫 Task 29 原訂的 12 項 checklist）在該 sandbox 環境下無法完整執行到「用真實 Google 帳號登入並操作四張表單」的程度——這件事本來就需要人類用真實帳號密碼親自完成，不是自動化測試的替代品。已完成的自動化驗證：完整測試套件（49 檔案、203 測試，含大量對真實 Supabase 專案的整合測試）全過、production build 成功且列出所有新路由、機密掃描乾淨（service-role key／SMTP 密碼只出現在對應的 server-only 檔案、無任何 `'use client'` 模組引用它們）、中介層對所有新路由的保護已透過檔案結構與既有 middleware 規則確認涵蓋。
