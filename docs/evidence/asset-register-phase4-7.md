# Asset register expansion — Phases 4–7 evidence

Date: 2026-10-31

## Phase 4 — Excel import + scoped asset queries

| Artefact | Path |
|---|---|
| Property import preview/confirm | `src/lib/assets/property-import.ts` |
| Server actions | `src/lib/assets/actions.ts` (`previewPropertyRegisterImport`, `confirmPropertyRegisterImport`) |
| Import UI | `/assets/import` |
| Scoped SQL queries | `src/lib/assets/scope-queries.ts` |
| My / dept / company UI | `/assets/mine` |
| AI tool | `search_my_assets` in `src/lib/ai-chat/tools.ts` |

### Acceptance

| Check | Status |
|---|---|
| Dry-run preview without writing | PASS (preview action returns counts/issues only) |
| Confirm creates/updates + inventory batch | PASS (idempotent via `asset_import_batches.idempotency_key`) |
| Unresolved custodians do not invent employees | PASS (`skip` / unresolved lists) |
| Mine / department / company scoped in SQL | PASS (`listAssetsForCurrentUser`, `searchAssetsForAi`) |
| AI cannot load all-company then filter | PASS (tool uses `searchAssetsForAi`) |

## Phase 5 — Company announcements

| Artefact | Path |
|---|---|
| Migration | `drizzle/0039_announcements_surveys.sql` |
| Service | `src/lib/announcements/service.ts` |
| UI | `/announcements`, `/announcements/[id]` |
| Assistant welcome reminders | `src/lib/ai-chat/welcome.ts` |

### Acceptance

| Check | Status |
|---|---|
| Draft / schedule / publish / withdraw | PASS |
| Audience company (dept/employees columns ready) | PASS (schema + service; UI defaults company) |
| Read vs acknowledge separate | PASS (`read_at` / `acknowledged_at`) |
| Plain-text body (no HTML injection) | PASS (`sanitizeAnnouncementText` + `whitespace-pre-wrap`) |
| Summary invalidates on version bump | PASS (`summary_cache` cleared on update) |
| Assistant mentions unread titles + link | PASS (welcome summary) |

## Phase 6 — Named surveys

| Artefact | Path |
|---|---|
| Tables | surveys / questions / responses in 0039 |
| Service | `src/lib/surveys/service.ts` |
| UI | `/surveys`, `/surveys/[id]` |
| CSV formula guard | `answersToCsv` + unit test |

### Acceptance

| Check | Status |
|---|---|
| Create / add questions / publish snapshot | PASS |
| Draft save + submit; one response per employee | PASS (unique constraint) |
| No question edits after publish (editor blocked) | PASS |
| Stats for `company.surveys_results` | PASS |
| Pending survey in assistant welcome | PASS |
| Anonymous surveys not claimed | PASS (copy + model is named only) |

## Phase 7 — Mobile adaptation (incremental)

| Surface | Mobile notes |
|---|---|
| `/assets/mine` | Card list `<md`, table `md+` |
| `/announcements` | Single-column cards; sticky-free detail |
| `/surveys/[id]` answer | Sticky bottom 暫存／提交; fieldsets stack |
| Field manager / import | Existing responsive grids |

Desktop paths unchanged. Full device-matrix screenshots (360–1280 + iOS/Android) remain for follow-up session with browser automation.

## Commands

```bash
# with .env.local loaded
npm run db:migrate
npx vitest run src/lib/assets/ src/lib/announcements/ src/lib/surveys/
npx tsc --noEmit -p tsconfig.json
```

## Follow-ups (not blocking phase gates)

- ~~Announcement attachment linking~~ → done (`0040_announcement_attachments`, upload/list/download/remove; smoke: PDF 200 / 322 B)
- ~~Full audience picker UI~~ → done (create form: company / department / employees; smoke OK)
- ~~Survey export download button~~ → done (`survey-export-button.tsx`)
- ~~Purge backup export / restore recognition~~ → done (`purge-backup.ts` + UI + `/api/assets/fields/purge-backup/[jobId]`)
- 18 field acceptance：自動化切片 `acceptance-cases.test.ts`（11 PASS）；關鍵 UI 截圖見 `docs/evidence/shots/10–13-assets-fields-*.png`（建立／列表／隱藏／purge 辨識）；完整 18 案例 Codex 包仍待
