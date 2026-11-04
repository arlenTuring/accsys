# AI 助手改善：分階段計畫與驗收

依據：使用者 2026-10-30 提供的「ACCSYS AI 助手改善」規格（第 0–8 階段）。
每階段依序：重現問題 → 修改 → 自動化測試 → 瀏覽器實測 → 驗收報告（`docs/ai-assistant/acceptance/S<n>.md`）。
前一階段未通過不得宣稱完成；不相依的工作可先做，但須標示仍被阻擋的項目。

共通完成定義：**使用者操作 → 後端執行結果 → DB 狀態 → 畫面結果 → 稽核紀錄** 五者可交叉核對。
模型說成功、HTTP 成功或畫面顯示成功，都不能單獨代表業務操作成功。
缺少憑證或服務時列為「未驗證」，不以 mock 代替真實整合驗收；自測通過後狀態為「待複驗」（由 Codex 複驗）。

## 共用測試環境

| 項目 | 指令／位置 |
|---|---|
| 拋棄式 DB | `npm run test:db:up`（tmpfs，127.0.0.1:25432，`accsys_test`）；`npm run test:db:down` 清除 |
| 固定測試資料 | `DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test npx tsx scripts/seed-ai-test-env.ts --manifest <檔案>`（可重跑、不重複） |
| 附件測試組 | `npx tsx scripts/gen-ai-attachment-fixtures.ts tmp/ai-attachments <公司統編>`（統編見 manifest） |
| 真實模型重現 | `scripts/ai-repro.ts`（只讀 `.env.local` 的 `AI_CHAT_*`，僅允許 `_test` DB） |
| 測試登入 | `scripts/ai-test-session.ts <檔案> [員工ID]`：session token 寫入檔案（不輸出），設為 `accsys_sid` cookie |
| 追蹤 | `select seq, stage, data from ai_turn_traces where turn_id = '<clientMessageId>' order by seq` |

第 3 階段以前固定使用同一組資料（`evidence/S0/test-data-manifest.json`）。

## 階段

| 階段 | 範圍 | 報告 | 狀態 |
|---|---|---|---|
| 0 | 問題基準與追蹤能力 | `acceptance/S0.md`（附錄 `S0-relative-date.md`） | 自測完成，待複驗 |
| 1 | 一句話真正填入 DB 草稿（A1–A8） | `acceptance/S1.md` | 自測通過，待複驗 |
| 2 | 草稿可靠保存、重試與跨對話（12 案例） | `acceptance/S2.md` | 自測通過，待複驗 |
| 3 | 對話內互動選項與補填介面（A2UI 評估、8 元件） | `acceptance/S3.md` | 自測通過，待複驗 |
| 4 | 附件三階段處理與一致性 | `acceptance/S4.md` | 自測通過，待複驗 |
| 5 | 照片裁切、旋轉及註解 | `acceptance/S5.md` | 自測通過，待複驗 |
| 6 | 核准單據 PDF 夾帶與簽核者預覽 | `acceptance/S6.md` | 自測通過，待複驗 |
| 7 | 主動提醒 | `acceptance/S7.md` | 自測通過，待複驗；真實拒絕流程未驗證（工作流程無此狀態） |
| 8 | 四條旅程完整回歸與驗收矩陣 | `acceptance/S8.md` | 自測通過，待複驗；未驗證項目見報告第 4 節 |
