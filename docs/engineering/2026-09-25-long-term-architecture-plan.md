# ACCSYS 長期技術架構與分階段改善計畫

日期：2026-09-25。狀態：依使用者地端部署要求修訂，尚未實作／部署。

**已確認的架構前提：GCP 只作初期測試主機，正式環境為公司地端伺服器。測試與正式使用同一套可攜式部署；不得依賴 GCP 專屬網路、資料庫、儲存、排程、IAM 或密鑰服務。此修訂取代前版的 Cloud Run／Cloud SQL 正式部署建議。**

本次只新增計畫文件，不修改程式、套用資料庫變更或操作雲端。目標是降低未來重構成本，讓 Claude Code 能按階段交付可測試、可回復的改善。長期穩定代表有受控升級與復原能力，不代表套件永遠不升級。

## 1. 決策摘要

| 層級 | 建議決策 | 理由與邊界 |
|---|---|---|
| 應用 | 保留 Next.js + TypeScript，單一應用、按業務模組分檔 | 不另建微服務或重寫另一套後端；商業邏輯移出 page/action，避免綁死框架 |
| DB 引擎 | 保留 PostgreSQL | 現有關聯、交易、numeric、constraint 都適合；沒有改成 MySQL、Firestore 或 MongoDB 的需求 |
| 正式 DB | 公司地端 PostgreSQL，獨立持久磁碟與異機備份 | 初期 GCP Linux VM 也跑同一 PostgreSQL；不用 Cloud SQL／Auth Proxy／IAM DB auth |
| DB 版本 | 遷移初期沿用 PostgreSQL 16；正式目標社群支援的 18 修補版 | 16→18 獨立演練；測試／地端相同 major，不以雲端平台預設版本決定 |
| 存取方式 | 保留 Drizzle + postgres driver，移除自製 Supabase 相容層 | 一套具型別查詢；必要時用參數化 SQL，禁止再造 query builder |
| Schema | Drizzle schema + 版控 SQL migrations | schema.ts 描述目標模型；migration SQL 是可稽核的變更紀錄；函式／trigger 用 custom migration |
| 登入 | Google OIDC Authorization Code + PKCE，使用 openid-client 穩定版 | 不繼續手刻協定驗證；沿用 iron-session 作 cookie 容器，避免同时導入第二套 Auth 平台 |
| 帳號識別 | 本地 employee UUID + Google issuer/sub 綁定 | email 是可變屬性；變更信箱不應重建員工、轉移舊單據或繼承別人的身分 |
| GWS 人員取用 | 獨立背景工作，Directory API 唯讀同步 | 登入不要求目錄管理權限；Google 人員資料與 ACCSYS 業務角色分開 |
| Session | PostgreSQL 可撤銷 session + cookie 內不透明隨機 token | 停權／登出能撤销舊 cookie；不因 GWS API 暫時故障而讓每次查詢都失敗 |
| 權限 | 伺服器端集中 policy + 每個入口查驗 | 現階段不用 DB RLS；應用 DB 帳號不對瀏覽器開放，不以 middleware／按鈕隱藏當權限 |
| 附件 | 地端持久檔案目錄，掛載主機資料磁碟；必要時公司 NAS | 以附件 ID 授權後串流；GCP 測試也用掛載磁碟，不存容器暫存層、不依賴 GCS |
| 正式執行 | Linux + Docker Compose + 公司既有 reverse proxy（無既有則 Nginx） | 同一映像與 Compose 在 GCP VM／地端運作；排程用 systemd timer，密鑰用主機受限檔案或公司既有保管服務 |

新依賴只接受直接解決已確認問題者：OIDC client、Google 官方 SDK、必要的瀏覽器測試工具；不引入通用工作流平台、Redis、Kubernetes、GraphQL 或多租戶框架。

### 其他方案的取捨

- Supabase 本身不是不穩定；但目前程式已移離其 Auth／RLS／Storage。再搬回去會形成第二次遷移，現階段沒有足夠收益。
- 地端 PostgreSQL 是正式目標；公司需指定修補、監控、備份與還原負責人。這些工作納入交付，不用 GCP 代管服務掩蓋地端需求。
- Auth.js／Identity Platform 可在未來多個系統共用登入或多身分供應商時再評估。本案單一 GWS 身分來源，先用標準 OIDC client + 現有 cookie 套件即可。
- 起始以單一應用主機／VM 與獨立備份位置為基準，單機不是 HA。若 RTO 要求自動切換，再利用公司既有虛擬化 HA 或另設 PostgreSQL standby；不先引入 Kubernetes／自製 failover。

## 2. 現況證據與已知限制

以下依本機工作目錄，不能當作正式環境現況。工作目錄已有大量未提交變更，後續執行不得 reset、clean 或覆蓋。

| 現況 | 來源 | 要處理的根本問題 |
|---|---|---|
| PostgreSQL 已取代 Supabase，仍有自製相容 query builder | src/lib/db/app-client.ts、src/lib/db/index.ts | any、字串查詢與錯誤包裝造成型別／錯誤語意不一致 |
| 舊交接仍寫 Supabase／Vercel | docs/superpowers/HANDOFF-plan7.md、README.md | 不能照舊文件執行 migration 或部署 |
| OAuth state 固定為 google，callback 未比對；只用 userinfo/email 綁員工 | src/app/auth/google/route.ts、src/app/auth/callback/route.ts、src/lib/auth/google.ts | 缺完整登入交易驗證、穩定身分與組織判定 |
| session 主要存 email，員工沒有停權欄位 | src/lib/auth/session.ts、src/lib/auth/current-employee.ts、db/schema.sql | 信箱變動、帳號重建、離職停權生命週期未建模 |
| 詳情／案件查詢沒有逐案授權；實際附件下載只檢查員工存在 | src/lib/purchase-requests/queries.ts、src/lib/cases/queries.ts、src/app/api/attachments/file/route.ts | 移除 RLS 後，授權未完整移至應用層 |
| 建立與簽核多次寫 DB，部分重送用 SQL function 刪除舊步驟 | src/lib/*/actions.ts、db/schema.sql | 交易一致性、併發與歷史稽核 |
| SQL 全量 create table 與 schema.ts 人工雙維護 | db/schema.sql、scripts/apply-schema.ts | 初始化腳本不是既有 DB 的增量升级工具 |
| 兩份本機附件實作 | src/lib/storage/local.ts、src/lib/attachments/storage.ts | 重複實作、正式儲存尚未接入 |
| 舊 RLS 測試仍呼叫 auth.admin/auth.signInWithPassword，新 client 沒有 auth | tests/integration/*rls.test.ts、tests/integration/supabase-test-client.ts | 測試必須遷移到真實應用權限邊界，不能只略過 |

2026-09-25 本機檢查：111 tests passed、195 integration tests skipped；TypeScript 在 scripts/apply-schema.ts:19 失敗；Lint 12 errors / 1441 warnings，含第三方 PDF worker 與相容層 any。未連 DB、未測正式 Google 登入、未跑 production build／真實瀏覽器驗收。這些數字是基準，不是後續驗收標準。

## 3. 長期資料模型與程式邊界

### 3.1 單一應用，明確責任

```text
page / route / server action
  → requireActor（有效 session、有效員工）
  → domain query / service（policy、輸入規則、transaction）
  → Drizzle / parameterized SQL → PostgreSQL

Google OIDC → identity binding → local session
systemd timer → 一次性 Workspace sync container → directory snapshot → local account state
attachment ID → policy → 地端持久檔案目錄
```

沿用 src/lib/<domain>，需要交易的模組增加 service.ts 即可；不要求每張表都加 repository interface。page/action 僅接參數、呼叫服務、回傳結果／revalidate。DB、Auth、Storage、Secret 模組標記 server-only。不要在 client bundle、Next cache 或全域變數保留跨使用者權限結果。

### 3.2 Schema 與遷移原則

1. 先在拋棄式 DB 重建現行結構，再用已授權取得的現有 DB 結構快照比對，不假設本機 SQL 等於正式 DB。
2. 建立 baseline migration。空 DB 必須從零建立；已存在 DB 必須先驗證 schema 等價，再受控登記 baseline 已套用。不得把 CREATE TABLE 直接重跑到既有 DB，也不得盲改 migration journal。
3. 固定 drizzle-kit 版本，驗證該版本的 baseline／migrator 行為；不得依賴較新版或 beta 才有的命令。必要時使用受審查的一次性 baseline 登記腳本，僅操作 migration metadata。
4. 新變更以 expand → backfill → validate → contract 執行。舊欄位／function 至少保留到新程式穩定且回復窗口結束。
5. 已套用 migration 不改寫；所有資料修補另寫可重跑的 migration／job，附修改前後筆數與核對。
6. db/schema.sql 最終只作產生出的參考快照，不再手改；supabase/migrations 保留歷史但不得用於新部署。
7. runtime DB 帳號只有必要 DML 權限；migration 帳號才有 DDL；DB 不對員工瀏覽器直接開放。
8. 使用金額 numeric(14,2)，業務計算統一為整數分／明確 decimal。若採整數分，拒絕超出安全整數及超過兩位小數輸入，資料邊界用 decimal string，不靠浮點相加或前端總額。既有非整數數量需求不在本次變更。
9. timestamp 用 timestamptz；業務日期用 date；案號月份由 Asia/Taipei 明確計算。測試 UTC 與台北 session timezone 得出一致案號月份。
10. 索引依實際查詢與 EXPLAIN 驗證；列表在 DB 篩選、排序和分頁，固定次排序鍵，避免全部載入再 filter。

### 3.3 必要的新增概念

實際欄位由各階段 migration 落實；不要提前新增無用欄位。

| 概念 | 最小資料與約束 |
|---|---|
| employees 帳號狀態 | 本地 access_enabled、停用原因／時間；保留 employee UUID，不硬刪有歷史紀錄的員工 |
| employee_identities | employee_id FK、provider、issuer、subject，UNIQUE(provider,issuer,subject)；本案每員工最多一個啟用的 Google 綁定；email 為屬性 |
| app_sessions | token_hash UNIQUE、employee_id、created_at、expires_at、revoked_at；cookie 不存可當權限依據的角色 |
| directory_users | directory_user_id、customer_id、primary_email、顯示姓名、suspended／archived／deleted、最後成功確認時間、可空 employee 對應 |
| directory_sync_runs | 開始／結束／成功狀態、頁數、筆數、錯誤摘要；勿存 access token 或完整敏感回應 |
| audit_events | actor、action、entity、time、request_id、必要差異；append-only，禁止 runtime 更新／刪除，避免存銀行帳號完整值與憑證 |

employee_identities 的 OIDC sub 與 Directory user ID 分別保存；只有經官方語意確認及實際一致性測試才共用／直接對應，不以 email 字串相等當永久身分證據。員工歷史與登入身分分離，使改名、轉部門、停權不破壞原單據。

目前一案一張 PO／驗收／費用單的唯一約束先保留；不趁技術重構改成一對多。API 使用明確 form ID，不再新增「只要 case ID 就假設唯一單據」的隱性依賴。

## 4. GWS 帳號取用方案

### 4.1 員工登入：只取得本人身分

- 公司持有 OAuth client、公司正式 HTTPS 網址與固定 APP_ORIGIN；dev/staging/prod 分開 client／callback。不可依未驗證的 Host／forwarded host 動態構造 callback。
- 使用 Google discovery + openid-client 穩定版。Authorization Code + PKCE S256；每次登入獨立 random state、nonce、verifier，10 分鐘過期，一次性消耗；callback 成功或失敗都清除登入交易。並行多分頁至少安全失敗，不串接別次交易。
- 驗證 ID token 簽章／issuer／audience／exp／nonce，email_verified 必須明確為 true，hd 必須位於公司已確認的 Workspace 網域清單。authorization URL 的 hd 只是提示，不能取代 callback 驗證。[Google OIDC](https://developers.google.com/identity/openid-connect/reference)
- 只索取 openid email profile，登入不保留 Google refresh token，不索取 Gmail／Drive／Directory scopes。
- 以 issuer + sub 找既有身份，再取得 employee UUID。新綁定必須來自 GWS 同步且管理員確認的名單，或受審查的 bootstrap 綁定；不得讓首次登入者只靠相同 email 自動接管既有 employee。
- 相同 email 但 sub 不同：拒絕登入、記錄衝突，管理員核對後另行處理，禁止自動覆蓋。別名、信箱改名不產生新員工。
- 初期無 Directory 權限時，保留管理員事先建立／核准的綁定模式；不採「公司網域任何人首次登入就自動獲得角色」。第一位 admin 綁定由 CLI／bootstrap 受控完成，不能使用常駐公開後門。
- 更換登入模型時統一使舊 email-only session 失效並重新登入，不做永久双模式 fallback。

### 4.2 本地 session 與停權

- iron-session 可保留，cookie 只攜帶高熵隨機 session token；DB 只存其雜湊。新登入建立新 token；HTTPS、HttpOnly、SameSite=Lax、明確有效期，登出使用 POST 並撤銷 DB session。
- Cookie 驗證的寫入入口必須防 CSRF：保留 Server Actions 的來源檢查，明確設定可信 origin；自行建立的 Route Handler 檢查 Origin 並採 CSRF token 等標準措施，不能只靠 SameSite。callback 依 OIDC state/PKCE 驗證。
- 建議起始 session 絕對壽命 8 小時、無永久 remember-me；可配置但不得超過公司政策。每個伺服器資料入口檢查 DB session、employee access_enabled、Directory 狀態與權限。
- 管理員在 ACCSYS 停權／撤銷 session：下次請求生效。角色變更：下次請求讀取新角色，禁止只在登入時快取。
- GWS 停權不會自動推翻既有 ACCSYS cookie。背景同步建議每 5 分鐘，處理時間目標 1 分鐘內；實際生效上限依排程與 API 可用性量測，不能宣稱即時。
- 建議 Directory 狀態 freshness 上限 15 分鐘；超時後已綁 GWS 帳號的新登入及受保護請求拒絕，顯示服務暫時不可用並告警。這會在 GWS 長時間故障時犧牲可用性，需公司確認；不能默默放行或把故障當全員離職。
- P2 尚未啟用 Directory 時明確採 manual 管理模式；P6 首次完整同步成功後才切換 directory 模式與 freshness gate。模式必須在部署設定與管理畫面可辨識，不能因缺設定自動降級。
- 復權分離：GWS 恢復 active 不得覆蓋本地管理員手動停權；pending 員工也不自動變 admin。離職後保留歷史，待簽工作交接列入管理員處理，不能自動換簽核人。

### 4.3 背景目錄同步：與登入隔離

- 固定一個 GWS customer ID（支援該公司已確認的多網域），分頁讀取 Directory users。取 primary email、固定 ID、姓名、OU、suspended、archived 等必要屬性。[Directory users](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users)
- systemd timer 啟動一次性 sync container／CLI，使用同一版應用映像；一般 web runtime 不掛載 Directory 同步憑證。無 Cloud Run Jobs／Cloud Scheduler／GCP metadata server 依賴。
- 預設由公司專用、具最小 Directory 讀取權限的 Workspace 管理帳號完成一次獨立 OAuth offline 授權；sync 使用 refresh token 取得短期 access token，scope 僅 admin.directory.user.readonly；確有 OU 主檔需求再加 orgunit.readonly。不使用個人 super admin，也不向一般員工索取目錄 scope。[Scopes](https://developers.google.com/workspace/admin/directory/v1/guides/authorizing)
- 同步使用獨立 OAuth client 與管理員授權流程（state／PKCE／固定 callback），由 Google 官方 SDK 管理續期。refresh token、client secret 只以受限密鑰檔掛載給 sync／一次性授權工具，不放 image、版控或一般 DB 欄位；登入 client 不取得這些 token。token 可能遭撤銷或受公司 session 政策影響，須處理 invalid_grant、告警、重新授權與輪替，不能假設永久有效。[Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- 預設不使用 domain-wide delegation（DWD）或 GCP IAM signJwt。若公司政策禁止長期 refresh token、必須改用 DWD，另開身分憑證決策並驗證地端憑證保存／輪替，不自行導入雲端 IAM 依賴。管理員未批准 API 授權時維持人工匯入／綁定；該模式不宣稱達成自動停權 SLA。
- 所有頁成功且資料檢核通過才標記本輪成功／更新完整快照。429／5xx 有限次退避重試；403、網域／customer 不符、筆數劇降要阻止破壞性套用並告警。
- 只有成功完整清單後的缺席才進一步 users.get／deleted 資料確認；查詢錯誤不等於刪除。已明確 suspended／deleted 的既有綁定必須停用存取並撤銷 session。
- job 以 DB lock 防止重疊，重跑不重複建立員工；先 dry-run 顯示差異，再對測試 tenant／測試帳號執行。同步 API 唯讀，但會寫 ACCSYS 的帳號狀態。
- 姓名／信箱／帳號生命週期以 GWS 為準；employee_code、財會／管理員角色、預算負責人、簽核主管以 ACCSYS 為準。GWS OU 不等於簽核部門；不自動以 OU、title、isAdmin 授予簽核或財務權限。

### 4.4 地端連線與外部依賴

- GWS 是仍然存在的外部服務，地端部署不等於離線 Google 登入。員工瀏覽器需能連 Google 登入；伺服器需透過公司允許的 outbound HTTPS 存取 OIDC discovery／JWKS／token 與 Directory API，另需 DNS／時間同步；不使用 GCP 私有網路或 VPN-to-GCP。
- callback 是瀏覽器重導向回公司 HTTPS 網址，瀏覽器在 LAN／VPN 能到達即可；不為 OIDC 專門讓 Google 從網際網路直連內網。網域須符合 Google redirect URI 規則，採公司合法 FQDN，非隨意 .local 名稱；實際註冊與內部 DNS／TLS 一起測試。[Google OAuth redirect](https://developers.google.com/identity/protocols/oauth2/web-server)
- OAuth client／啟用 Google API 仍需公司持有的 Google API 專案設定。這是 GWS 整合的註冊資料，與 GCP 測試 VM 分離管理，不需正式主機部署在 GCP，不應在移除測試 VM 時刪掉 OAuth 註冊。
- 外網中斷時新 Google 登入無法完成；既有 session 依 4.2 的明確 manual/directory 模式與 freshness 規則運作。測試「地端服務正常但 Google 不可達」；不得自動開啟 dev login 或停用授權。若公司要求長時間斷網仍能登入，須另行規劃地端 IdP，不能聲稱 GWS-only 達成。

## 5. 共通授權與資料一致性規格

### 5.1 權限預設矩陣

| 操作 | 授權規則 |
|---|---|
| 表單／附件讀取 | 申請人、該單簽核人、finance、admin；跨表單案件頁只顯示被授權內容，不能因任一單據可讀就全案明細全開 |
| 核准／退回 | 僅目前有效關卡的指定簽核人；admin 不自動繞過 |
| 修改／撤回／重送 | 申請人 + 既有狀態規則；交易內再次驗證 |
| 預算／專案維護 | finance 或 admin |
| 員工、身份綁定與業務角色 | admin，記稽核紀錄；不可直接授予自己未核准的更高權限 |
| 財會案件追蹤／匯出 | finance 或 admin；查詢函式本身仍需 guard |
| 開發登入 | development 且顯式 enable；正式一律關閉，與真實 Google sub 分離 |

P0 先盤點實際業務例外，例如跨人員建立後續採購單；若需要部門或承辦人權限，應明確補入矩陣與測試，不默默放寬所有 staff。純 helper 可接入已驗證 actor，但對外可呼叫資料入口不能只有 UI gate。

### 5.2 交易規範

- 四種表單的 create／approve／return／edit／withdraw／resubmit，在同一 DB transaction 寫表頭、明細、目前簽核關卡、站內通知與 audit event。
- 所有狀態變更先 SELECT ... FOR UPDATE 同一張表頭，再檢查狀態、當前關卡、actor；鎖順序一致，重送／修改也遵守。建立尚無表頭時鎖來源表或靠唯一約束序列化。
- 防止 stale edit 覆蓋較新資料：表單版本號／updated_at 條件檢查，回覆衝突而不是最後寫入者取勝。
- 建立採用 actor + operation + idempotency key 唯一性與 payload fingerprint；同 key 同內容重試回同結果，不同內容拒絕。不能只用按鈕 disabled。
- 通知 event 有穩定唯一鍵（含單據版本／回合與步驟）；避免重試造成多筆站內通知。
- 不在 transaction 裡呼叫 SMTP／Google／Storage。Email 尚未啟用，先不增加 broker；真正啟用時將 outbox 紀錄與業務 transaction 同寫，背景重試，明示外部寄件可能 at-least-once，不保證 exactly-once。
- 不刪掉唯一一份歷史簽核：重建目前 steps 前，把原步驟／原表單必要版本快照寫入 audit；runtime 不得修改／刪除 audit。若需完整重現附件／每一歷史版本，另定保存需求，不能宣稱目前 audit 已是完整法遵存證。
- 錯誤至少區分 unauthenticated / forbidden / not_found / validation / conflict / unavailable；DB 故障不能轉成空列表或成功。給使用者安全訊息，server log 留 request ID 與診斷內容，不輸出 token、銀行帳號或 SQL 參數中的敏感資料。

## 6. Claude Code 分階段執行

依序 P0→P1→P2→P3→P4→P5→P6→P7。P2/P3 可先在本機完成，不必等 GWS 管理員；P6 無管理員配合則明確標示受阻，不影響前段交付。每個子步驟一個可 review 的 commit／變更批次，不把整份計畫一次執行完。跨階段共同驗收：型別、lint、unit、該階段 DB integration、production build；權限與登入階段另加 browser tests。

### P0：保護現況、測試基線與執行環境

**範圍**：package.json、lockfile、tsconfig、eslint、vitest、測試設定、CI、scripts/apply-schema.ts、文件。

工作：

1. 記錄 branch／HEAD／dirty paths，辨識現有未提交工作；取得包含當前工作內容的安全基線。隔離工作目錄若只從 HEAD 建立會漏掉現況，不得直接當完整專案。
2. 固定 Node 24 LTS 與 npm／lockfile，先驗證相容性；移除已不必要的 experimental-websocket 旗標。依官方生命週期確認套件，不使用 canary／beta。[Node release policy](https://github.com/nodejs/Release)
3. 修復現有 TypeScript 錯誤；Lint 排除第三方生成 PDF worker，修自有程式錯誤，不全域關閉 no-explicit-any／嚴格模式。
4. 加 typecheck 與 integration 專用腳本；tests 納入獨立 TypeScript 檢查，建立表格將舊 RLS 測試逐項對應到新 policy 測試。舊不相容測試暫時隔離須記錄原因與 P3/P5 到期，不可宣稱全數通過。
5. 測試只允許專用 TEST_DATABASE_URL 和可辨識測試 DB；整合 CI 缺 DB 時失敗，不默默 skip。不載入 .env.local 的真實 DB；單元測試與 DB 測試清楚分開。
6. 建立 CI：npm ci、lint、typecheck、unit、拋棄式 PostgreSQL integration、build。檢查敏感檔忽略規則，禁止測試寄真信／改真員工。
7. 從 P0 即建立最小 Dockerfile／Compose 測試啟動基線（app、PostgreSQL、附件 volume），使之不依賴 GCP。P7 再補正式 reverse proxy、備份與部署驗收，避免最後才發現容器／地端不相容。

**驗收**：新環境可重現非 DB 檢查；當前不相容 integration 有完整替代清單；CI 失敗能指出真實原因。記錄 production build 是否需要建置時網路／字型，若需要則固定來源或本地化。

**回復**：只回復本階段設定與程式，不動既有使用者改動／資料。

### P1：DB migration 基線

**前置**：P0。**範圍**：db/、drizzle.config.ts、src/lib/db/schema.ts、scripts、DB tests。

工作：baseline、schema 差異報告、增量 migrations、runtime/migration 帳號分離；加入 P2 需要的身份／session／停權表欄位與 audit 最小結構。既有員工資料不得按 email 直接產生已驗證 sub 綁定。

**驗收**：空 DB 全量建立、既有結構副本 baseline 接管、升級後重跑 no-op、資料筆數／外鍵／金額合計不變；函式、索引、check 也納入比對。兩個 migrator 並行不能重複套用；migration 僅部署 job 執行，web 啟動不自動跑。

**回復**：新增結構保留，舊 app 可讀寫原欄位；不得把還原整個 DB 當日常 rollback。

### P2：穩定 Google 登入與帳號生命週期

**前置**：P1。**範圍**：src/lib/auth/*、src/app/auth/*、middleware／對應框架入口、登入頁、身份 migration。

工作：第 4.1/4.2 節 OIDC、identity binding、DB sessions；建立安全 bootstrap 與員工本地停權操作，保留尚未配置 Directory 的核准名單模式。受保護服務統一 requireActor，middleware 只負責導航。

**驗收**：錯誤 issuer/aud/nonce/state、過期 token、缺 email_verified、hd 不符、callback 重放、惡意 Host、email 重用都拒絕；合法 sub 改 email 仍為同一 employee；登出與本地停權後舊 cookie 失效；未知員工無資料存取；production dev login 被拒絕；測試 admin bootstrap 後關閉入口。

自動測試使用本地 OIDC fixture／模擬 provider，不以 mock 掉整個驗證器當完整覆蓋；另在 staging 用公司測試帳號完成真實登入。不得要使用者把密碼／token 貼到聊天或文件。

**回復**：可回復到前一個已修正的登入版本並統一要求重新登入；若只能回到不安全 email-only 登入，停止對外服務，不重新開放舊入口。

### P3：完整授權與附件存取邊界

**前置**：P2。**範圍**：所有 queries/actions、API routes、cases、notifications、attachments、policy 模組與 integration。

工作：逐項套用第 5.1 節，盤點所有直接 createAppDb/getDb 呼叫及 Server Actions；附件改以 attachment ID 查 metadata→policy→object key，關閉任意 path 下載；重複本機 storage 合併，檔名僅作顯示，object key 由伺服器生成；拒絕 path traversal，限定檔案大小與實際格式。

**驗收**：未登入、無員工、非參與者、跨部門 staff、申請人、未輪到的簽核人、當前簽核人、finance、admin 的正／負測試。直接訪問 URL、直接呼叫 action、持有他人 attachment ID、舊 path URL 均測試。錯誤不能透出案件內容；GWS 群組／OU 不授權 admin。

**回復**：程式可回到前一個有完整 policy 的版本；不得為救 UI 重新開放不受保護 endpoint。

### P4：交易、併發、金額與稽核

**前置**：P3。**範圍**：四種表單 services/actions、approval、notifications、audit、custom migrations。

依序 P4a 請購、P4b 採購、P4c 驗收、P4d 費用；每一批完整搬移一條垂直流程，使用 Drizzle transaction，遵守第 5.2 節，不先造通用工作流引擎。原 SQL resubmit function 在無呼叫者前不刪除。

**驗收**：真實 PostgreSQL 的兩條獨立連線測試 approve/approve、approve/return、approve/edit、approve/withdraw、重複 create；只能有合法的最終結果與單一通知。每個寫入步驟注入失敗，表頭、明細、steps、audit、站內通知一起 rollback。先通過請購再推廣其餘模組。

另測小數與金額上限、伺服器重算總額、<10000 與 >100000 既有門檻、無簽核人、台北月份交界、重送歷史可追溯。保留既有一對一業務規則。

**回復**：逐模組回復兼容版本；已寫入資料不逆向重算、不刪 audit；新交易路徑與舊路徑不得同時寫同一流程。

### P5：移除相容層、升級維護版本與查詢收斂

**前置**：P4。**範圍**：剩餘 queries、master data、budget、projects、測試、框架設定。

工作：

1. 剩餘查詢逐模組轉 Drizzle，DTO 有明確型別；刪除 app-client.ts 與舊 Supabase mock／auth 測試，替代測試需先通過。統一 DB 錯誤處理，不回空 data 掩蓋故障。
2. 財會列表將部門／關鍵字／日期／分頁推到 DB；檢查查詢計畫，消除實際重複／逐筆查詢，不為小資料先加 cache。
3. 獨立批次升級到實作時受支援的 Next.js Active LTS（本計畫預設 16）及相容 React；先閱讀正式 upgrade guide，再調整 middleware/proxy、bundler/PDF worker。不要同時換 UI 框架。[Next.js support policy](https://nextjs.org/support-policy)
4. 清理未用依賴與過時部署說明；README 指向新架構／runbook，歷史交接保留。

**驗收**：runtime 無 Supabase 相容層引用；所有待替代測試已替代、核心 integration 無 skip；typecheck 涵蓋測試；build、Google 登入、四表單與 PDF 匯出 smoke 通過；代表性資料量的查詢 latency／計画留紀錄。

**回復**：套件升级與查詢改寫分開 commit，可各自回復；保留 lockfile 精確版本。

### P6：GWS 唯讀人員同步

**前置**：P2/P3/P5；外部條件為 GWS 管理員、customer ID、批准專用同步帳號與 OAuth 唯讀 offline 授權。**範圍**：workspace sync module、job、directory migrations、管理員差異頁／命令與 audit。

工作：實作第 4.3 節；先純 fixture 解析與 dry-run，再測試 tenant，再小範圍公司測試名單。提供未綁定／衝突／停權／待交接報告。新員工先 pending，只有 admin 完成員工對應與角色後可進入。

**驗收**：多頁、空頁、重複 ID、email 改名、同 email 新 sub、suspended／archived／deleted、手動停權不被復權、429/403/timeout、第二頁失敗、筆數劇降、同時啟動兩 job。失敗不造成全員誤刪；freshness 超時依已定政策拒絕；完整成功後恢復；舊單據／歷史員工 ID 不改。

**回復**：停止 systemd timer 與撤銷同步 OAuth 授權可獨立操作；保留最後快照、audit、本地停權。切換人工管理須明確標示已失去自動停權能力，不以關掉 freshness 檢查偷偷恢復所有人。

### P7：可攜式部署、GCP 測試搬地端與維運驗收

**前置**：P0–P6 核心驗收；若 P6 選人工模式，記錄停權責任與未達自動同步目標。先交付部署設定／runbook；真實主機、憑證、資料搬遷與切換在授權範圍內執行。

P7a 地端標準部署：

- Linux VM／伺服器 + Docker Engine／Compose。reverse proxy → app → PostgreSQL；sync／migration／backup 為獨立一次性工作。沿用公司 proxy；沒有則使用 Nginx。Compose 設定適用 GCP 測試 VM 與地端。[Compose production](https://docs.docker.com/compose/how-tos/production/)
- build 一次，部署相同 immutable image digest；公司 registry 或 docker save/load 傳送映像，不強制 Artifact Registry／Cloud Build。不得在正式主機 npm install latest。架構需與目標 CPU 相符，記錄 Docker／Compose 支援版本。
- 主機／網域／掛載目錄／密鑰檔路徑透過配置切換；程式不判斷「在 GCP 還是地端」。不實作 VPC、Cloud Load Balancing、Cloud NAT、Cloud SQL、GCS、Secret Manager 或雲端身分登入 DB。GCP VM 必要的測試連線由主機管理者提供，不作為應用架構依賴。
- PostgreSQL 用標準 driver／SCRAM 帳密；同主機 Compose 私有網路不公開 DB port，跨主機走公司受控 LAN + TLS。禁止沿用開發環境 host 0.0.0.0:15432 與預設帳密；防火牆僅開必要入口。
- DB data、附件、backup staging 各有明確持久 volume／bind mount；記錄容量、UID/GID、磁碟故障處理。PGDATA 預設獨立本機磁碟，不直接放一般 SMB/NFS 分享。附件需擴到多 app 實例時，所有實例共享受支援 NAS 或另評估公司既有物件儲存，未驗證前維持單 app。
- 附件採 server-generated opaque key，path 留相對值，授權後 app 串流；檔案目錄不能由 Nginx static alias 或公開 SMB 直接繞過授權。阻擋 traversal／symlink 越界；暫存寫入後原子 rename，再標記 metadata ready，失敗可清理／重試。
- secrets 由主機管理員保管，以限權唯讀檔案掛載（Docker Compose secrets／公司既有密鑰服務），不存 image／Git／一般 log。Compose secrets 本身不保證主機檔案加密；需磁碟／備份加密、獨立存放還原金鑰、輪替及交接。web、sync、migration、backup 掛載各自必要密鑰。
- systemd timer 啟動 compose run --rm 的一次性同步／備份命令，DB lock 防重疊，退出碼與輸出送公司既有監控；主機開機後服務自動恢復。禁止把 Docker socket 掛給一般 web，禁止依賴 request 結束後執行背景工作。
- PostgreSQL pool 上限按 app process／同步／migration／backup／管理連線加總，低於 max_connections 並保留餘裕；限制 app worker 數量。設定重啟策略、健康檢查、graceful shutdown、磁碟與 log rotation。
- 公司正式 HTTPS FQDN、DNS、憑證續期、NTP 都列入部署。LAN／VPN 使用者透過公司網域訪問；proxy 清除客戶端偽造的 forwarded headers，app 固定 APP_ORIGIN。

P7b DB 升級與 GCP→地端搬遷：

- PG16→18 是獨立演練，可在 GCP 測試期先完成；本機／CI／測試／正式保持相同 major。用 pg_dump/restore 或已驗證的官方升級方式，不能直接把舊 volume 掛到新 major。升級與換主機分開執行，避免同時有兩個變因。
- 跨主機搬遷以同 major PostgreSQL logical dump/restore + 附件檔案複製為基準，核對 schema/functions/extensions、UUID、單據數量、金額合計、案號 counter 與附件 checksum；不以整顆 GCP VM snapshot 當地端還原格式。
- GCP 是測試環境，預設測試单據／persona／sessions 不搬入正式；先分類可搬的主檔與確需保留的真資料。若現況仍有舊 Supabase 資料，也必須辨認唯一可信來源，不把雲端測試 DB 當自動唯一來源。
- 真資料切換採公告窗口：停止來源寫入與同步→最後一致備份→地端 restore→補 migrations→搬附件→對帳→角色 smoke→切正式網址。舊端保持唯讀；測試與正式 OAuth client 分離，舊 session 失效，正式同步憑證獨立授權。
- 新端開始寫入前可退回舊端；開始寫入後不能只切回舊 DB，須維護模式保留並對帳新資料，再向前修復或受控回復。
- **搬遷驗收必須在沒有 GCP credentials、metadata server、Cloud SQL／Storage／IAM API 的地端等效環境通過**：只修改部署配置、搬資料與注入密鑰，不修改業務程式。Google OIDC／Directory 必要外連另列為允許的外部整合。

P7c 地端維運與復原（目標需確認、演練證明）：

- 指定 OS／Docker／PostgreSQL 修補負責人，管理員至少兩人可接手。記錄主機保固／UPS／磁碟告警、備機或新 VM 重建步驟；單機與同一台主機上的多 container 不算 HA。
- 備份使用 PostgreSQL 基礎備份 + WAL 歸檔支援 PITR，採成熟工具（預設評估 pgBackRest 並驗證目標平台），不用自製備份框架。可另做 logical dump 供可攜搬遷，但每日 dump 不足以承諾 15 分鐘 RPO。[PostgreSQL PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- 備份存公司獨立主機／NAS／離線媒體，至少有一份不與 app/DB 共用故障位置或可刪除憑證；加密與還原金鑰分開保管，不能只備份到同磁碟另一資料夾。地端備份不依賴 GCP。
- 附件不可變保存，備份與 DB 建立可核對的 manifest／時間界線；恢復點對應到的每個 ready 附件必須存在。若需要整體 RPO≤15 分鐘，附件複本／備份頻率也須達標，不能只驗 DB WAL。
- 建議整體 RPO≤15 分鐘、RTO≤4 小時；若硬體／備份／網路無法達成，先調整明訂目標。每季還原到另一台乾淨 VM，驗證 DB+附件+設定+密鑰+登入+一筆測試簽核，不覆蓋線上 DB。
- 監控 app 錯誤率、DB 連線、磁碟餘量／I/O、憑證到期、NTP、同步 freshness、WAL 歸檔／備份失敗、排程狀態。使用公司既有監控，沒有則先提供 health/exit status 與日誌規格，不強制加整套新監控平台。
- 每月安全修補、每季還原／權限盤點、每年檢查 PostgreSQL／Node／Next 支援期限。[PostgreSQL lifecycle](https://www.postgresql.org/support/versioning/)

**最終驗收**：CI／build／角色測試、地端 HTTPS 真實 Google 登入、GWS token 失效與重新授權、停權、外網中斷、附件與 DB 重启持久性、GCP→地端演練、異機還原、管理員交接。成本表改為硬體／虛擬機、磁碟／NAS、備份、UPS、網路與維運人力；GCP 測試費另列，不作為正式架構前提。

## 7. 各階段交付格式與停止條件

每階段產出 docs/engineering/progress/Pn.md，包含：基線 commit／工作目錄狀態、完成項目、異動檔案、schema/data 影響、實際測試命令與結果、未執行項目及原因、rollback 方法、下一階段依賴。不得只寫「全部完成」。

若發現 schema 與真實資料不符、identity 配對不唯一、migration 可能刪真資料、既有使用者變更衝突，停止該項依賴工作並提出具體差異。可繼續獨立的文件／測試準備，不擅自猜測或把 migration 改成 drop-and-recreate。

計畫中的日常程式修正／測試不要求每步都問批准；真正需外部管理員權限或影響公司資料的動作，先交付可審查命令、影響範圍與回復方案，再在既有授權範圍內執行。

## 8. 公司需要確認的少數決策

未回覆時可先依預設完成本機程式與計畫，不建立真實資源：

1. 地端伺服器 OS／CPU 架構、RAM／磁碟、是否有虛擬化平台或 NAS、DNS／HTTPS／VPN 與對外連線限制；GCP 僅測試已確認，不再重新詢問正式平台。
2. GWS customer ID、正式與次要網域、可配合的管理員，是否允許專用管理帳號與唯讀 OAuth offline 授權；若公司已有另一種整合政策再調整。
3. 是否接受同步每 5 分鐘、狀態超過 15 分鐘未確認即拒絕存取；若偏重離線可用性，需要重新明訂停權風險窗口。
4. 是否已有正式員工／真實單據，現在唯一可信 DB／附件來源在哪裡；GCP 測試資料是否丟棄、需搬哪些主檔；允許的停機窗口。
5. 稽核、單據、附件的保存期限與 RPO/RTO，及維運負責人。

## 9. Claude Code 啟動方式

請使用同目錄的 CLAUDE-CODE-EXECUTION.md。這份文件是本次架構改善的主要依據；歷史 superpowers 文件僅供了解原業務行為。若公司後續確認不同架構，先更新決策與受影響階段，不悄悄換套件或另造一套身份系統。
