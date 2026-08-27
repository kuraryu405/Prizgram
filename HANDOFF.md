# HANDOFF — Prizgram (linux 2026-08-27: fix/166 + fix/177)

## 対象Issue / 目的
- **直近対応**: #166 Bug P2 reflection source pin (PR274) のフォーマット不具合を修正、CIをpassさせた。#177 Docs P3 manual import spec統一 (PR276) を新規作成。
- **除外ルール**: Landing #269 は EXCLUDED: LANDING_PAGE で対象外。`TARGET = ALL(25) - EXCLUDED(1) = 24`
- **最終目標**: TARGET==0 までPR作成を継続、セルフマージ禁止

## 現在のブランチ状態
- `main` HEAD: `83abb52 fix(e2e): repair shared Browser E2E failures` (origin/main 同期済み、2026-08-27 時点)
- `fix/166-persona-reflection-source` HEAD: `699f947 style: fix prettier formatting for persona update (#166)` (origin に force push済み)
  - 元の `3976ffc chore: add HANDOFF` はフォーマットfailのため除去、 `1bb609d` (core fix) + `699f947` (format fix) の2コミット構成に整理
  - PR https://github.com/kuraryu405/Prizgram/pull/274 OPEN, Validate monorepo PASS (2026-08-27 07:03→再push後PASS), Browser E2E pending/skip
  - 差分は HANDOFF.md を含まずクリーン (5 files: service.ts, page.tsx, flow.tsx, service.test.ts, llm-rate-limit-routes.test.ts)
- `fix/177-product-docs` HEAD: `6ed5793 docs: clarify manual job import as body paste+optional URL (#177)` (origin push済み)
  - PR https://github.com/kuraryu405/Prizgram/pull/276 OPEN, Validate pending (lint/typecheck locally PASS)
- その他OPEN PR: #271 `codex/121-stage-label` (MERGEABLE UNKNOWN), #272 `codex/120-minimal-registration` (base: codex/121-stage-label, stacked), 過去の #270/#273 はクローズ済み

## 実装済み内容 (今回セッション)

### PR274 フォーマット修正
- 原因: `pnpm format:check` が `apps/web/src/app/app/persona/page.tsx:183` と `apps/web/src/server/persona-update/service.ts:236` と `HANDOFF.md` でfail
- 対応:
  - `pnpm format` で2ファイルを prettier 修正 (page.tsx: ternary1行化, service.ts: `isAnyReflection` 1行化)
  - `git reset --hard HEAD~1` で HANDOFF commit (3976ffc) を除去、format fixのみを `699f947` として再commit
  - `git push --force-with-lease` で origin 更新、CI再実行で Validate PASS を確認
  - HANDOFF.md はuntrackedとして `/tmp/HANDOFF_backup.md` と `./HANDOFF.md` に退避、PR差分には含めない方針 (mainを汚染しない)
- 検証: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm test` 380 pass, `pnpm build` pass

### PR276 #177 Docs統一
- 背景: `docs/product.md:31` の `求人票本文や URL` が URL-onlyでも登録可能と誤読される。実装は `body >=40 chars必須 + sourceUrl任意` (apps/web/src/server/jobs/service.ts:38,58,81 / job-import-form.tsx:28)
- 変更:
  - `docs/product.md:31` を `求人票本文（必須、40文字以上）を貼り付け、必要に応じて出典URL（任意）を添えて手動登録できる。URLのみからの自動取得（server-side fetch / crawler）はMVP対象外` に修正
  - `docs/product.md:101` (6.4) を `求人票本文の貼り付けを必須とし、出典URLは任意の付帯情報として手動入力を許可。URLのみを入力してサーバー側で取得する機能はMVPでは提供しない` に修正
- 検証: `pnpm format:check` pass, `lint` pass, `typecheck` pass, `test` 377 pass (main baseline), `build` pass
- PR: https://github.com/kuraryu405/Prizgram/pull/276 (base main, Closes #177)

## 未実装・残タスク

### TARGET_OPEN 分類 (2026-08-27取得、25件中 TARGET24)
```
ALL 25, EXCLUDED 1 (#269), TARGET 24
G: #269 Landing (除外)
C (既存PR対応中): #166→PR274, #121→PR271, #120→PR272 stacked
D (解決済みだがClose漏れ/妥協):
  #261 PR266 mergedだが Refsでopen残り、コードは対応済み (home dashboard)
  #159 migration 0008で note追加済みだが issue ACの全ケーステスト/E2E未検証でopen残り
  #184 migration 0008で jobVersionId nullable追加済みだが ACはNOT NULL要求、現状nullable+fallbackで妥協
A (実装可・独立):
  #177→PR276で対応済み (本セッション)
  #262 [UX][P1] Application中心集約 ← 次候補 P1
  #118 [UI/UX] 冗長説明文削除 ← 次候補 小〜中
  #117 [UI/UX] Toast統一 ← 中
  #256 multi-provider化 ← 中
  #219 パスワード変更 (codex/219-password-change ブランチ存在するがPRクローズ、要再PR化)
B (依存/後回し): #263/#264 AI系 (persona/job前提で後), #125 ES管理 (Application前提)
F (要判断/Backlog P3 - MVPでは着手しない明記): #215, #214, #199, #155, #140, #138, #116, #115, #109
```

**推奨順**: #262 P1 → #118 → #117 → #256 → #219 → AI系 (263/264)。Backlog P3は実施しない。

### 既存Open PR状態
- PR274 fix/166: Validate PASS, 手動で Ready for review維持、self-merge禁止
- PR276 fix/177: Validate pending → 間もなくPASS見込み
- PR271/272: codex/121, codex/120 stacked、Validateはpassだが Browser E2E fail傾向、要監視

## 次に編集すべきファイル

- #262 なら:
  - `apps/web/src/server/applications/service.ts` (現在 jobVersion pinはnullable対応済み、UI集約不足)
  - `apps/web/src/app/app/applications/page.tsx`, `[id]/page.tsx`
  - `apps/web/src/app/app/jobs/[id]/page.tsx`, `apps/web/src/components/jobs/*`
- #118 なら:
  - `apps/web/src/app/app/page.tsx:388行付近`, `apps/web/src/app/app/deadlines/page.tsx:71`, `apps/web/src/app/app/reminders/page.tsx`, `apps/web/src/app/app/jobs/page.tsx:19`, `apps/web/src/app/app/applications/page.tsx` のタイトル直下説明文
  - `apps/web/src/app/app/persona/page.tsx` は既に#166で修正済み
- #117 なら: 新規 `apps/web/src/components/ui/toast.tsx` + `apps/web/src/app/app/layout.tsx` に provider
- #177 は本PRで完了、次回はPR276のCI確認のみ

## 実行・テスト・lint・buildコマンド
```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test          # vitest run (40 files, 377 baseline / 380 with #166)
pnpm build
pnpm db:generate   # drizzle generate drift check
pnpm db:migrate
pnpm test -- apps/web/src/server/jobs/service.test.ts  # 単一
```

## 注意点

- **HANDOFFの扱い**: 本セッションでPR差分からHANDOFF.mdを除去しuntracked退避した。mainへHANDOFFが混入しないようにするため。以降のhandoffは別ブランチ `handoff/*` にpushするか、PRとは別管理とすること。現在untracked HANDOFFは `./HANDOFF.md` と `/tmp/HANDOFF_backup.md` に存在、次agentは `cat HANDOFF.md` で読めるが、fresh cloneでは消失するため必要なら `git show origin/fix/166-persona-reflection-source:HANDOFF.md` ではなく `./HANDOFF.md` を参照すること。次回は本ファイルを更新して `fix/177` や `handoff/*` にpushして引き継ぐこと。
- **Formatting**: `pnpm format:check` は `./HANDOFF.md` も対象にする。PRに含めないならuntrackedでもローカルでfailするので `pnpm format` で直すか、一時的に `mv HANDOFF.md /tmp/` してからチェックすること。本セッションではHANDOFF自体をformat済みにしてあるため `format:check` はpassする。
- **Issue Close**: #261, #159, #184 はコードは実装済みだがissueはopen。Closeは `Closes` 付きPRか手動closeだが、雑にclose禁止のため現状放置。次回 #159/#184 を厳密にNOT NULL化するなら migration追加+backfillが必要。
- **Stacked PR**: #272 は baseが codex/121-stage-label。単独でmainにrebase不可。
- **CI**: Browser E2Eは従来failしやすいが Validate monorepoが本丸。PR274はValidate PASSを確認済み。
- **Landing除外**: `gh issue list` で `ALL - LANDING (#269) = TARGET` を毎回再計算、TARGET==0でゴール。

## 次のagentが最初に実行するコマンド
```bash
git fetch --all --prune
git status
git branch --show-current
git log --oneline --decorate -5
cat HANDOFF.md
gh issue list --state open --limit 30 --json number,title,labels,state
gh pr list --state open --limit 30 --json number,title,headRefName,baseRefName,state,mergeable
gh pr checks 274
gh pr checks 276
gh pr view 274 --json headRefName,state,mergeable,mergeStateStatus,url
gh pr view 276 --json headRefName,state,mergeable,mergeStateStatus,url

# 次ブランチを切る場合
git switch main
git pull --ff-only
git switch -c fix/262-application-hub  # または fix/118-ui-copy
# 実装 → pnpm lint / typecheck / test / build → PR作成 (Closes #xxx 必須)
```

Linux再開時は本HANDOFF.md と `git log origin/fix/177-product-docs --oneline` を source of truthとし、過去の記憶よりGitHub上の最新状態を優先すること。
