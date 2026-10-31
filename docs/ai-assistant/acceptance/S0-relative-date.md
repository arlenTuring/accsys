# 第 0 階段附錄：相對日期句子（「下週三」）重現

- 日期：2026-10-30（Asia/Taipei，週五）。句中「下週三」= **2026-11-04**。
- 分支：`p0-baseline-hardening`（未 commit，見文末「變更檔案」）。
- 環境：拋棄式測試 DB `accsys_test`（`docker-compose.test.yml`，127.0.0.1:25432），測試帳號 `T-STAFF`（測試員工，`20000000-0000-0000-0000-000000000001`），測試專案 `T-PRJ-A 測試專案 A`。
- 模型：真實 Vertex Gemini（`gemini-3.8-flash`，公司後端 ADC 呼叫，未使用個人金鑰）。
- 本階段**只重現與定位**，不修正 AI 行為（修正在 S2/S3）。

## 1. 驗收目標與結果

| # | 驗收目標 | 結果 | 證據 |
|---|---|---|---|
| 1 | 用獨立測試帳號、真實 Gemini 執行規格句子 | 通過：腳本 6 次（5 次單句、1 次三回合）＋ UI 1 次 | `evidence/S0/relative-date/single-*.json`、`multi-1.json`、`ui-turn-trace.jsonl` |
| 2 | 每回合以單一關聯 ID 追蹤：登入者、對話、表單與 schema 版本、工具呼叫／結果／失敗原因、draftId、欄位更新、DB 前後版本 | 通過：關聯 ID = 使用者訊息的 `clientMessageId`，寫入 server log（一行 JSON）與 `ai_turn_traces` | 第 3 節 |
| 3 | 記錄前端收到的事件與畫面 | 通過：`turn.ui_events`（openResources、blockKinds）＋ 截圖（送出後、重新整理後） | `evidence/S0/relative-date/ui-after-turn.jpg`、`ui-after-reload.jpg` |
| 4 | 日誌不記錄憑證、完整發票或不必要個資 | 通過：預設只記鍵名／型別／長度；欄位值只在 `AI_TRACE_VALUES=1` 且非 production 才記；token/secret/password/cookie/bank account/base64/bytes 一律 `[redacted]` | `src/lib/ai-chat/trace.ts`、`trace.test.ts` |
| 5 | 依規格七類分類每次失敗並提出實證根因 | 通過 | 第 4、5 節 |

## 2. 期望結果（判定基準）

`business-trip`（公出差旅申請單）一句話後，DB 草稿應為：
`tripStartAt = 2026-11-04 09:00 (+08:00)`、`tripEndAt = 2026-11-04 18:00 (+08:00)`、`location = 台中`、`purpose` 含「設備驗收／拜訪客戶」；
「掛在測試專案 A」：**此表單 schema 沒有專案欄位**，正確行為應是告知使用者此表單無專案欄位（並詢問是否寫入事由），而非自行把專案塞進文字欄位假裝已掛上。

## 3. 每回合實測（真實 Gemini）

| 執行 | 耗時 | 工具回合（r=回合） | 回合耗盡 | patch 寫入欄位 | DB 結果 | 結論 |
|---|---|---|---|---|---|---|
| single-1 | 10.6s | r0 list_filable_forms+search_projects → r1 create → r2 describe → r3 patch | 是 | location, purpose, itinerary | v2，**無起訖時間** | 失敗 |
| single-2 | 11.6s | r0 search_projects+list_filable_forms → r1 create → r2 describe → r3 list_my_notifications | 是 | 無 | v1 `{}` | 失敗 |
| single-3 | 12.5s | r0 list_filable_forms+search_projects → r1 create → r2 describe → r3 list_my_notifications | 是 | 無 | v1 `{}` | 失敗 |
| single-4 | 33.6s | r0 search_projects+create → r1 describe → r2 list_my_notifications → r3 search_my_submissions | 是 | 無 | v1 `{}` | 失敗 |
| single-5 | 14.1s | 同 single-1 | 是 | location, purpose, itinerary | v2，**無起訖時間** | 失敗 |
| multi-1 #1 | 12.0s | 同 single-1 | 是 | location, purpose, itinerary | da99e9d2 v2，無起訖時間 | 失敗 |
| multi-1 #2「日期是 2026-11-04…請填進去」 | 11.3s | r0 list_filable_forms → r1 search_projects → r2 create（重用） → r3 patch | 是 | tripStartAt, tripEndAt | da99e9d2 v3（值無時區） | 部分成功 |
| multi-1 #3「另外開一張…台北…供應商會議」 | 7.1s | r0 create（initial_data 含 4 個不存在的欄位）→ r1 patch | 否 | 5 個正確欄位 | 699c36d7 v2，**另存 4 個垃圾鍵** | 失敗（資料污染） |
| UI（瀏覽器，同一句） | ~12s | r0 search_projects → r1 create（**重用台北那張**）→ r2 describe → r3 patch | 是 | location, purpose, itinerary | 699c36d7 v3：台中／設備驗收 ＋ 台北的 11/06 時間 | 失敗（覆寫他單） |

**首句成功率：0 / 7**（6 次腳本首句 + 1 次 UI）。沒有任何一次寫入正確日期。

DB 實際狀態（UI 回合後，`select data from ai_application_drafts where id='699c36d7-…'`）：

```json
{"location":"台中","purpose":"設備驗收（專案：測試專案 A / T-PRJ-A）","itinerary":"拜訪客戶進行設備驗收",
 "tripStartAt":"2026-11-06T09:00:00","tripEndAt":"2026-11-06T18:00:00",
 "destination":"台北","startTime":"2026-11-06T09:00:00","endTime":"2026-11-06T18:00:00","tripSummary":"到台北開會（供應商會議）"}
```

## 4. 依規格七類分類

| 類別 | 是否發生 | 實證 |
|---|---|---|
| 模型未呼叫更新工具 | **是**（3/7 首句） | single-2/3/4：建立草稿後未呼叫 `patch_application_draft`，第 4 回合改呼叫無關的 `list_my_notifications`／`search_my_submissions`；草稿停在 v1 `{}`。 |
| 工具回合或時間耗盡 | **是**（7/7 首句、8/9 回合） | trace 出現 `model.request {mode:"NONE", reason:"tool_rounds_exhausted"}`。上限 `maxToolRounds: 4`（`src/lib/ai-chat/config.ts:65`）。成功寫入的回合也都是在最後一個回合才 patch。時間未耗盡（最長 33.6s < 120s）。 |
| 欄位或參照 ID 不合法 | **是** | multi-1 #3：`create_application_draft.initial_data_json` 帶入不存在的 `destination/startTime/endTime/tripSummary`，`createApplicationDraft`（`src/lib/ai-chat/drafts.ts:218`）**完全不驗欄位**，直接寫入 DB；右側面板顯示「資料庫欄位 9 項」。專案：表單無專案欄位，模型把「測試專案 A / T-PRJ-A」塞進 `purpose` 文字，沒有任何參照 ID 被儲存。 |
| 權限／對話綁定限制 | **是（綁定造成錯誤重用）** | `create_application_draft` 在 `initial_data` 為空時，**重用本對話同表單的既有草稿**（`src/lib/ai-chat/tools.ts:765-811`）。UI 實測：新的台中請求被寫進台北那張草稿，產生混合資料（見上 JSON）。另外，聊天頁載入時自動進入最近對話（標題仍顯示「新對話」），使用者無從察覺是接續舊對話。未觀察到權限拒絕。 |
| DB 更新失敗 | 否 | 所有 `patch_application_draft` 皆 `ok=true`，版本 +1。 |
| 版本衝突 | 否 | `expected_version` 每次都與 DB 相符；但 patch 為淺層合併，未來明細表格會整欄覆寫（S2 處理）。 |
| DB 成功但 UI 未更新 | **否（畫面＝DB）**，但**文字與畫面不一致** | UI 回合後右側面板顯示 v3、台中、2026/11/06 09:00–18:00，與 DB 完全相同；重新整理後仍相同（`ui-after-turn.jpg`、`ui-after-reload.jpg`）。但助手回覆說「請提供下週三的確切日期」，同時面板顯示的是另一趟行程的 11/06 時間；回覆也未告知覆寫了另一張草稿。 |

## 5. 根因（依影響排序）

1. **模型不知道「今天」與時區。** `SYSTEM` 指示（`src/lib/ai-chat/vertex-client.ts:35`）與每回合內容都沒有目前日期／時區。single-1 回覆原文：「因系統未取得當前基準日期」。結果 7/7 首句都沒寫起訖時間；使用者給明確日期時（multi-1 #2）才寫入，且值為無時區字串 `2026-11-04T09:00:00`。
2. **一次填單至少要 3 個循序工具回合，上限只有 4。** 流程被拆成「查表單／查專案 → 建立空白草稿 → 讀欄位 → patch」；每回合模型都重新呼叫 `list_filable_forms`、`search_projects`，因為**歷史只帶文字**（`turn.ts` 中 history 只取 `contentText`，trace `historyCarriesDraftIds:false`），沒有權威的工作狀態（目前草稿、欄位、缺漏）。單純提高回合數只會延後問題，不是修正。
3. **建立草稿時的重用規則會覆寫別張單。** 「同對話＋同表單＋initial_data 為空 → 重用」無法區分「繼續這張」與「另開一張」，造成資料污染（UI 實測）。
4. **後端未驗證 AI 寫入的欄位與值。** `createApplicationDraft` 不檢查欄位；`patchApplicationDraft` 只在能載入 schema 時檢查欄位名稱，不檢查值型別／格式／時區；`patch_json` 是二次序列化字串。
5. **回合耗盡時的備援文字洩漏內部訊息且誤導。** single-2 回覆全文為工具摘要：「草稿已寫入資料庫。UI 會用 open_resource 開啟文件；請接著 patch 已知欄位…」，但 DB 草稿是空的 `{}`（`fallbackTextFromTools`，`vertex-client.ts:204`）。
6. **表單沒有專案欄位**，模型為了滿足「掛在測試專案 A」把專案寫進事由文字並宣稱完成。應由後端欄位規格告訴模型此表單無專案欄位，模型照實告知。
7. **回覆在未做必填檢查時就叫使用者「按送出」**；回覆內容沒有以後端回傳的已儲存狀態為準。

S1 期間另修正一個**僅影響測試腳本**的問題：在非 HTTP 請求環境呼叫工具會出現 `` `cookies` was called outside a request scope ``；以 `runWithSessionToken`（AsyncLocalStorage）提供 session，仍走 `resolveSession` 驗證，正式請求路徑行為不變。

## 6. 對 S2/S3 的修正方向（下一階段驗收依據）

- 每回合注入權威工作狀態：今天日期、時區（Asia/Taipei）、目前草稿 id／版本／已填與缺漏欄位、完整欄位規格（含「此表單無專案欄位」）。
- 合併「建立＋填入」：一個工具即可建立並寫入結構化欄位（非字串 JSON），回傳儲存後版本、已更新欄位、缺漏欄位、錯誤。
- 後端驗證欄位與值（日期時區正規化、金額、選項、參照 ID），不合法時拒絕並回報，不寫入。
- 「繼續」與「另開」明確區分：只有指定 draftId 才更新既有草稿；建立一律新建（以 turnId 去重防重送）。
- 回合耗盡時不輸出內部訊息；回覆中「已填入」只引用後端回傳的已儲存欄位。

## 7. 重現步驟

```bash
npm run test:db:up          # 拋棄式 DB（tmpfs）＋ migrations ＋ 測試 fixtures
DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test npx tsx scripts/seed-ai-test-env.ts
DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test AI_TRACE_VALUES=1 \
  npx tsx scripts/ai-repro.ts --out /tmp/s1.json "幫我建立下週三到台中拜訪客戶的公出申請，上午九點到下午六點，掛在測試專案 A，原因是設備驗收。"
```

- `ai-repro.ts` 只從 `.env.local` 讀 `AI_CHAT_*`（模型專案／區域），不讀其他變數；DB 名稱不是 `_test` 結尾即拒絕執行。
- UI 重現：以測試 DB 啟動 dev server（覆寫 `DATABASE_URL`、`MIGRATION_DATABASE_URL`、`STORAGE_LOCAL_PATH`、`APP_ORIGIN`），用 `scripts/ai-test-session.ts <檔案>` 產生測試 session（token 寫入檔案、不輸出），設為 `accsys_sid` cookie 後開 `/tools/ai-chat`。
- 依關聯 ID 查追蹤：`select seq, stage, data from ai_turn_traces where turn_id = '<clientMessageId>' order by seq;`

測試：

```bash
npx vitest run src/lib/ai-chat src/lib/auth   # 18 files / 96 tests passed
```

## 8. 變更檔案（S1）

| 檔案 | 內容 |
|---|---|
| `src/lib/db/schema.ts`、`drizzle/0032_ai_turn_traces.sql`、`drizzle/meta/_journal.json`、`drizzle/meta/0032_snapshot.json` | 新表 `ai_turn_traces`（turn_id+seq 唯一、依對話與時間索引）。**Migration 說明**：0032 SQL 只建這張表；snapshot 同時補上 0026–0031 手寫 migration 已建立、但先前 snapshot 缺漏的表，因此之後 `drizzle-kit generate` 不再產生重複 DDL。journal `when` 設為 1793700000000 以維持遞增。 |
| `src/lib/ai-chat/trace.ts`、`trace.test.ts` | TurnTrace 與去敏摘要；5 個單元測試。 |
| `src/lib/ai-chat/turn.ts` | 從 `actions.ts` 抽出 `runAssistantTurn(employee, input)`，讓 UI server action 與腳本走同一路徑；加入追蹤事件。 |
| `src/lib/ai-chat/actions.ts` | `sendAiChatMessage` 改為取得登入者後呼叫 `runAssistantTurn`。 |
| `src/lib/ai-chat/vertex-client.ts`、`tools.ts` | 追蹤每回合模型請求／回應、工具呼叫／結果；工具可接收已驗證的 `actor`。 |
| `src/lib/auth/current-employee.ts` | `runWithSessionToken`（非請求環境的 session 範圍，仍經 DB 驗證）。 |
| `scripts/seed-ai-test-env.ts`、`ai-repro.ts`、`ai-test-session.ts` | 只允許 `_test` DB 的測試環境、真實模型重現、測試 session。 |

## 9. 未解決／交給下一階段

- 上述根因 1–7 全部留待 S2（填單可靠性）與 S3（草稿身分與同步）修正；本階段刻意未改 AI 行為。
- 既有、與本階段無關的 typecheck 錯誤（`seed-ai-business-trip-fixtures.ts`、`verify-business-trip-pdf-flow.ts`、approved-snapshots route 等）與 `tools.ts` 既有 lint `prefer-const` 未處理。
- 頁面重新整理時短暫顯示「助手處理中…／傳送中…」，實際並未送出（log 無新 `turn.start`），屬 S3 的儲存狀態指示範圍。
