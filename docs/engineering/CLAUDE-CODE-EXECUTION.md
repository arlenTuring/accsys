# 給 Claude Code 的分階段執行指令

主計畫：[ACCSYS 長期技術架構計畫](2026-09-25-long-term-architecture-plan.md)。

**架構前提已修訂：GCP 僅初期測試，正式部署在公司地端。測試與地端用同一套 Linux／Docker Compose、PostgreSQL、持久附件目錄與 systemd 排程，不得導入 GCP 專屬服務或網路依賴。**

目前只有計畫，P0–P7 都尚未執行。本文件不表示允許直接操作正式 DB、Google Workspace 或 GCP；各次任務只執行使用者指定階段。

## 第一次可直接貼上的指令

```text
請讀取 docs/engineering/2026-09-25-long-term-architecture-plan.md，
以及適用的 AGENTS.md / CLAUDE.md（如果存在）。

這次只執行 P0：保護現況、建立測試基線與執行環境，不做 P1 以後的功能。
先檢查 git status；工作目錄有既有未提交的資料庫、登入、UI 與 PDF 功能，
不得 reset、clean、覆蓋或以只包含 HEAD 的新 worktree 當成完整現況。
若需要隔離工作，先保留包含目前未提交內容的基線，避免遺漏既有成果。

本次要真正修正並驗證 P0 範圍，不只重述計畫。
只能使用拋棄式測試 DB，不連 .env.local 的真實資料庫；不更動 GCP/GWS。
建立 P0 的最小可攜容器基線；不得導入 Cloud SQL、Cloud Run、GCS、
Cloud Scheduler、Secret Manager 或 GCP IAM／VPC 依賴。
不要安裝其他身份平台、改 DB 引擎、重寫 UI 或新增業務功能。
把舊 Supabase 整合測試與新 policy 測試的替代關係列清楚，不能把 skip 當通過。

完成後建立 docs/engineering/progress/P0.md，記錄異動、實際測試結果、
尚未完成的項目、回復方式與 P1 前置條件，最後回報後停止。
沒有跑過的測試明確寫未執行，不自行執行下一階段、部署、push 或合併。
```

## 後續每個階段的通用指令

將下方 Pn 換成 P1、P2 等；P4 建議分別指定 P4a/P4b/P4c/P4d，P7 分別 P7a/P7b/P7c。

```text
請依 docs/engineering/2026-09-25-long-term-architecture-plan.md 執行 Pn。
先讀 docs/engineering/progress/ 中前置階段的實際完成紀錄，檢查 git status，
確認前置驗收是真的通過。文件寫完成但測試未完成，不視為可跳過的依賴。

維持既定方向：PostgreSQL + Drizzle、單一 Next.js 應用、Google OIDC sub 身分綁定、
可撤銷 session、集中應用權限；Directory 唯讀同步與登入分離。
正式目標為地端，GCP 僅測試 VM；相同映像與 Compose 搭配主機持久磁碟，
GWS 同步使用獨立 OAuth offline 授權與地端 systemd timer，非 GCP IAM／Jobs。
遷移到地端只能改配置／搬資料，不改業務程式。
保留舊資料 ID、金額、案號與業務規則，不趁重構改一對多、預算制度或 UI 設計。
每個變更批次必須有必要的正向／負向測試與回復策略。

本次只執行 Pn，在本機／拋棄式測試環境驗證。
需要真實管理員權限的驗收先備妥操作步驟、所需最小權限與影響範圍，
未有明確授權時不要直接操作公司環境；可獨立完成的工作繼續完成。
新身份綁定不得只靠相同 email 自動接管歷史員工資料。
所有 database migration 必須測試空庫和既有資料副本，禁止 drop-and-recreate。

完成 docs/engineering/progress/Pn.md，交代每項驗收的實際結果與待辦後停止。
不自行啟動下一階段、push、合併或部署。
```

## 進度紀錄模板

```markdown
# Pn 執行紀錄

- 日期／基線 commit：
- 執行前工作目錄狀態：
- 狀態：未開始／進行中／本機完成待外部驗收／完成／受阻
- 本次範圍：

## 完成項目與檔案

## Schema／資料／權限變更

## 驗收

| 項目 | 命令或操作 | 結果與證據 |
|---|---|---|

## 未完成與原因

## 回復方法與限制

## 下一階段前置條件
```

## 執行紀律

- 既有未提交變更不是可丟棄檔案；不自行 stash/clean/reset 使用者工作。
- 新依賴需說明具體用途；不製造通用 ORM、流程引擎、微服務或多雲框架。
- 不為了測試變綠而關掉嚴格檢查、刪負向測試、全域 skip 整合測試。
- 不記錄 OAuth token、session token、DB 密碼、service account key 或完整銀行資料。
- 不把停用 GWS 同步當成自動停權已完成，也不把本機測試當成真實 Google 登入驗收。
- production build、權限負向測試、併發測試、migration 演練各有不同目的，不能互相替代。
- 外部變更的批准應針對可 review 的具體動作；沒有主機／GWS 管理權限時先完成程式、fixtures、Compose／systemd 設定與 runbook。
- Google API 專案僅供 OAuth／Directory 註冊，與 GCP 測試 VM 生命週期分離；不以為搬地端就能離線 Google 登入。
- P7 必須通過无 GCP 執行環境的部署與還原驗收，不把 GCP 上跑通當作地端完成。
