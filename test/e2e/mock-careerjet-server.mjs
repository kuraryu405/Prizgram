/**
 * Mock Careerjet partner search API for browser E2E tests. Serves the same
 * wire contract as https://search.api.careerjet.net/v4/query (basic auth,
 * required caller context, JOBS/LOCATIONS envelopes) so the discovery loop
 * runs against a realistic provider without network access.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_CAREERJET_PORT ?? 4142);

const jobs = [
  {
    title: "フロントエンドエンジニア（新卒）",
    company: "株式会社キャリアジェット",
    date: "Tue, 25 Aug 2026 09:00:00 GMT",
    description:
      "ReactとTypeScriptを用いたフロントエンド開発インターンです。メンターが付き、コードレビューを通じて実務スキルを伸ばせます。週3日以上の勤務をお願いします。",
    locations: "東京都渋谷区",
    salary: "時給1,800円",
    salary_currency_code: "JPY",
    url: "https://jobviewtrack.example.test/v2/e2e-frontend",
  },
  {
    title: "バックエンドエンジニアインターン",
    company: "株式会社サンプルデータ",
    date: "Mon, 24 Aug 2026 03:00:00 GMT",
    description:
      "Node.jsとSQLiteを使うバックエンド開発インターンです。API設計から運用まで体験できます。フルリモートで週2日から勤務可能です。",
    locations: "リモート",
    url: "https://jobviewtrack.example.test/v2/e2e-backend",
  },
];

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/v4/query") {
    response.writeHead(404).end();
    return;
  }
  // The provider contract requires basic auth and caller context params.
  const auth = request.headers.authorization;
  if (auth === undefined || !auth.startsWith("Basic ")) {
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "Missing or invalid credentials" }));
    return;
  }
  if (
    url.searchParams.get("user_ip") === null ||
    url.searchParams.get("user_agent") === null
  ) {
    response
      .writeHead(403, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "Missing param user_ip or user_agent" }));
    return;
  }

  const location = url.searchParams.get("location");
  if (location === "存在しない勤務地") {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        type: "LOCATIONS",
        locations: [],
        message: "no matching location found",
        response_time: 0.05,
      }),
    );
    return;
  }

  // Simulate realistic latency so pending states are observable.
  setTimeout(() => {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        type: "JOBS",
        hits: jobs.length,
        pages: 1,
        response_time: 0.12,
        jobs,
      }),
    );
  }, 50);
});

server.listen(PORT, () => {
  console.log(`[mock-careerjet] listening on http://localhost:${PORT}`);
});
