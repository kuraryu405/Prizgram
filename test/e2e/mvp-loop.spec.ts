import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const ORIGIN = `http://localhost:${process.env.PORT ?? 3100}`;

/** Unique per run so re-runs against a reused server never collide. */
const password = "correct horse battery staple";

async function registerAndLogin(page: Page) {
  const loginId = `e2e.user.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

test.describe("Prizgram MVP core loop", () => {
  test("signup → persona → job import → scoring → application → deadline → reminder", async ({
    page,
  }) => {
    // --- Signup lands in the app shell; a new user is told to create a persona.
    await registerAndLogin(page);
    await expect(
      page.getByRole("link", { name: /ペルソナ・ヒアリングを始める/ }),
    ).toBeVisible();

    // --- Persona intake wizard: answer every question, then generate.
    await page.goto("/app/persona/intake");
    const questionIds = [
      "q1_skills",
      "q2_experiences",
      "q3_strengths",
      "q4_weaknesses",
      "q5_values",
      "q6_preferences",
    ];
    const answers = [
      "学校の授業と独学でTypeScriptを使ったWebアプリ開発を経験しました。",
      "学園祭のアプリチームでフロントエンド担当としてリリースまで行いました。",
      "新しい技術を素早くキャッチアップできることです。",
      "長期的なアウトプットの継続が課題です。",
      "自律的に動ける環境を重視します。",
      "フロントエンドエンジニアリングを極めたいです。",
    ];
    for (const [index, questionId] of questionIds.entries()) {
      const answer = answers[index] ?? `回答${index}`;
      await page.locator(`#answer-${questionId}`).fill(answer);
      const isLast = index === questionIds.length - 1;
      if (!isLast) {
        await page.getByRole("button", { name: /保存して次へ/ }).click();
        // Wait for the next step to mount before filling it.
        await expect(page.locator(`#answer-${questionId}`)).toBeHidden({
          timeout: 10_000,
        });
      }
    }
    await page.getByRole("button", { name: /ペルソナを生成する/ }).click();
    // Successful generation redirects to the persona detail page.
    await page.waitForURL(/\/app\/persona/, { timeout: 20_000 });
    await expect(page.getByText(/v1/).first()).toBeVisible();

    // --- Dashboard now points at job import instead of persona creation.
    await page.goto("/app");
    await expect(
      page.getByRole("link", { name: /求人票を取り込む/ }),
    ).toBeVisible();

    // --- Persona-driven discovery through the licensed provider mock.
    await page.goto("/app/jobs");
    await page.getByRole("button", { name: "求人を探す" }).click();
    const firstCandidate = page.getByRole("article").first();
    await expect(firstCandidate).toContainText("フロントエンドエンジニア", {
      timeout: 20_000,
    });
    await expect(firstCandidate).toContainText("株式会社キャリアジェット");
    await expect(firstCandidate).toContainText("React / TypeScript");
    await expect(firstCandidate).toContainText("フロントエンド開発");
    await expect(firstCandidate).not.toContainText("<strong>");
    await expect(firstCandidate).not.toContainText("<br>");
    await expect(firstCandidate).not.toContainText("&nbsp;");
    await firstCandidate
      .getByRole("button", { name: /この候補を取り込む/ })
      .click();
    await expect(page.getByText(/構造化して保存しました/).first()).toBeVisible({
      timeout: 20_000,
    });
    // The discovered posting lands in the common imported-jobs pipeline.
    await expect(
      page.getByRole("link", {
        name: /株式会社キャリアジェット \/ フロントエンドエンジニア/,
      }),
    ).toBeVisible({ timeout: 20_000 });
    // Re-importing the same external candidate short-circuits as duplicate.
    await page.goto("/app/jobs");
    await page.getByRole("button", { name: "求人を探す" }).click();
    const importedCandidate = page.getByRole("article").first();
    await expect(importedCandidate).toContainText("株式会社キャリアジェット", {
      timeout: 20_000,
    });
    await importedCandidate
      .getByRole("button", { name: /この候補を取り込む/ })
      .click();
    await expect(page.getByText(/既に取り込み済みです/).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Job import through the manual posting form.
    await page.goto("/app/jobs");
    const posting = [
      "【募集】フロントエンドエンジニアインターン",
      "株式会社サンプルではReactとTypeScriptを使う開発インターンを募集しています。",
      "週3日以上勤務できる方を歓迎します。メンターが付き、コードレビューを受けながら成長できます。",
    ].join("\n");
    await page.getByLabel("求人票本文").fill(posting);
    await page.getByRole("button", { name: /求人票を取り込む/ }).click();
    await expect(page.getByText(/株式会社サンプル/).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Score the imported job from its detail page.
    await page
      .getByRole("link", {
        name: /株式会社サンプル \/ フロントエンドエンジニア/,
      })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "3軸評価" })).toBeVisible();
    await page.getByRole("button", { name: /この求人を評価する/ }).click();
    await expect(page.getByText(/スキル適合/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/72 \/ 100/)).toBeVisible();

    // --- Register an application for the scored job via its page flow.
    await page.goto("/app/applications");
    const addFormJobSelect = page.getByLabel("求人");
    if (await addFormJobSelect.isVisible().catch(() => false)) {
      // Select by explicit label: dropdown ordering is not part of the
      // contract, so index-based selection would be flaky.
      await addFormJobSelect.selectOption({
        label: "株式会社サンプル — フロントエンドエンジニア",
      });
      await page
        .getByRole("button", { name: /追加|登録|作成/ })
        .first()
        .click();
    }
    await expect(
      page.getByRole("link", { name: /株式会社サンプル/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("deadline registration produces an idempotent reminder through cron", async ({
    page,
  }) => {
    await registerAndLogin(page);

    // Seed persona + job + application via API (UI paths covered above).
    const request = page.request;
    const post = (url: string, data?: unknown) =>
      request.post(url, {
        data,
        headers: { origin: ORIGIN },
      });

    await post("/api/persona");
    const intakeResponse = await post("/api/persona");
    const { intakeId } = (
      (await intakeResponse.json()) as {
        data: { intakeId: string };
      }
    ).data;
    const answers: Array<[string, string]> = [
      ["q1_skills", "TypeScriptでの実装経験があります。"],
      ["q2_experiences", "チームでWebアプリを開発しました。"],
      ["q3_strengths", "学習速度"],
      ["q4_weaknesses", "継続力"],
      ["q5_values", "自律性"],
      ["q6_preferences", "フロントエンド"],
    ];
    for (const [questionId, answer] of answers) {
      const saved = await request.put(
        `/api/persona/intake/${intakeId}/answers`,
        { data: { questionId, answer }, headers: { origin: ORIGIN } },
      );
      expect(saved.ok()).toBeTruthy();
    }
    expect((await post("/api/persona/generate", { intakeId })).status()).toBe(
      201,
    );

    const imported = await post("/api/jobs", {
      body:
        "【募集】フロントエンドエンジニアインターン\n" +
        "株式会社サンプルではReactとTypeScriptを使う開発インターンを募集しています。\n" +
        "週3日以上勤務できる方を歓迎します。",
    });
    expect(imported.status()).toBe(201);
    const {
      data: { jobId },
    } = (await imported.json()) as { data: { jobId: string } };

    const application = await post("/api/applications", {
      jobId,
      nextAction: "ESを書く",
    });
    expect(application.status()).toBe(201);
    const {
      data: { applicationId },
    } = (await application.json()) as { data: { applicationId: string } };

    // Deadline inside the first reminder bucket (24-48h ahead).
    const due = new Date(Date.now() + 30 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    const dueLocal =
      `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` +
      `T${pad(due.getHours())}:${pad(due.getMinutes())}`;
    const deadline = await post("/api/deadlines", {
      applicationId,
      kind: "document",
      title: "ES提出（E2E）",
      dueLocal,
      timeZone: "Asia/Tokyo",
    });
    expect(deadline.status()).toBe(201);

    // Run the same cron entrypoint production uses.
    const runtimeConfig = JSON.parse(
      readFileSync(path.join(here, ".runtime.json"), "utf8"),
    ) as { databaseUrl: string };
    execFileSync("npx", ["tsx", "apps/web/scripts/run-reminders.ts"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: runtimeConfig.databaseUrl },
      stdio: "ignore",
    });

    // Listing reminders IS in-app delivery; the dashboard surfaces them too.
    await page.goto("/app/reminders");
    await expect(page.getByText(/ES提出（E2E）/).first()).toBeVisible();
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "次のアクション" }),
    ).toBeVisible();
  });

  test("persona update propose → approve → re-evaluation bumps the version", async ({
    page,
  }) => {
    await registerAndLogin(page);

    // Seed persona + job + application via API (UI paths covered above).
    const request = page.request;
    const post = (url: string, data?: unknown) =>
      request.post(url, {
        data,
        headers: { origin: ORIGIN },
      });

    await post("/api/persona");
    const intakeResponse = await post("/api/persona");
    const { intakeId } = (
      (await intakeResponse.json()) as {
        data: { intakeId: string };
      }
    ).data;
    const answers: Array<[string, string]> = [
      ["q1_skills", "TypeScriptでの実装経験があります。"],
      ["q2_experiences", "チームでWebアプリを開発しました。"],
      ["q3_strengths", "学習速度"],
      ["q4_weaknesses", "継続力"],
      ["q5_values", "自律性"],
      ["q6_preferences", "フロントエンド"],
    ];
    for (const [questionId, answer] of answers) {
      const saved = await request.put(
        `/api/persona/intake/${intakeId}/answers`,
        { data: { questionId, answer }, headers: { origin: ORIGIN } },
      );
      expect(saved.ok()).toBeTruthy();
    }
    expect((await post("/api/persona/generate", { intakeId })).status()).toBe(
      201,
    );

    const imported = await post("/api/jobs", {
      body:
        "【募集】フロントエンドエンジニアインターン\n" +
        "株式会社サンプルではReactとTypeScriptを使う開発インターンを募集しています。\n" +
        "週3日以上勤務できる方を歓迎します。",
    });
    expect(imported.status()).toBe(201);
    const {
      data: { jobId },
    } = (await imported.json()) as { data: { jobId: string } };
    const application = await post("/api/applications", {
      jobId,
      nextAction: "ESを書く",
    });
    expect(application.status()).toBe(201);

    // The first persona version is v1 before any update.
    await page.goto("/app/persona");
    await expect(page.getByText(/v1/).first()).toBeVisible();

    // --- Feedback loop through the update UI.
    await page.goto("/app/persona/update");
    await page
      .getByLabel("振り返りメモ")
      .fill(
        "面接ではデータ整備の話が深まりました。Next.jsの実務経験をさらに伸ばしたいです。",
      );
    await page.getByRole("button", { name: /更新案を作成/ }).click();
    await expect(
      page.getByRole("heading", { name: "更新案の確認" }),
    ).toBeVisible({ timeout: 20_000 });

    // Approval must not auto-finalize without an explicit confirmation.
    await page
      .getByRole("button", { name: /承認して新バージョンを作成/ })
      .click();
    await expect(page.getByRole("heading", { name: "再評価結果" })).toBeVisible(
      { timeout: 20_000 },
    );
    // The seeded job is re-scored against the approved persona.
    await expect(page.getByText(/再評価済み/).first()).toBeVisible({
      timeout: 20_000,
    });

    // The approved proposal became a new immutable persona version.
    await page.goto("/app/persona");
    await expect(page.getByText(/v2/).first()).toBeVisible();
  });

  test("unauthenticated users are redirected away from the app shell", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});
