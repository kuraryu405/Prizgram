/**
 * Mock OpenAI-compatible Chat Completions server for browser E2E tests.
 * Returns a deterministic structured payload per requested schema name so
 * the whole MVP loop runs without any real LLM dependency.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4141);

const personaSnapshot = {
  skills: [
    { name: "TypeScript", level: "intermediate", evidenceRefs: ["ev:e1"] },
  ],
  strengths: ["学習速度が速い"],
  weaknesses: ["継続的なアウトプット"],
  values: ["自律性"],
  preferences: {
    roles: ["フロントエンドエンジニア"],
    industries: [],
    workStyles: [],
    locations: [],
  },
  experiences: [
    {
      title: "Webアプリ開発",
      description: "チームでWebアプリを開発した。",
      startedOn: null,
      endedOn: null,
      evidenceRefs: ["ev:e2"],
    },
  ],
  evidence: [
    {
      id: "ev:e1",
      sourceType: "user_input",
      sourceId: "q1_skills",
      summary: "TypeScriptでの実装経験",
    },
    {
      id: "ev:e2",
      sourceType: "user_input",
      sourceId: "q2_experiences",
      summary: "Webアプリ開発経験",
    },
  ],
  confidence: 0.6,
};

/** Job import provider payload (normalized by JobService afterwards). */
const jobSnapshot = {
  company: "株式会社サンプル",
  role: "フロントエンドエンジニア",
  employmentType: "internship",
  description:
    "ReactとTypeScriptを使うフロントエンド開発インターン。週3日以上勤務できる方を歓迎します。",
  requirements: [{ text: "TypeScriptの実装経験" }],
  desiredSkills: [{ text: "Reactの使用経験" }],
  cultureValues: [{ text: "自律的に動く文化" }],
  difficultyLevel: "competitive",
  difficultyEvidence: [{ section: "requirements", index: 0 }],
};

/**
 * Extraction is content-dependent: postings fetched from the discovery mock
 * carry their own employer, which the snapshot must reflect so the common
 * import pipeline demonstrably structures the supplied text.
 */
function jobPayloadFor(body) {
  if (typeof body === "string" && body.includes("株式会社キャリアジェット")) {
    return {
      ...jobSnapshot,
      company: "株式会社キャリアジェット",
      description:
        "ReactとTypeScriptを用いたフロントエンド開発インターン。メンターが付き、コードレビューを通じて実務スキルを伸ばせます。",
    };
  }
  return jobSnapshot;
}

const scoring = {
  skillFit: {
    score: 72,
    reasons: ["要件のTypeScript実装経験がペルソナのスキルと一致"],
    evidenceRefs: ["persona:ev:e1", "job:job:req:1"],
  },
  cultureValueFit: {
    score: 55,
    reasons: ["自律的な文化はペルソナの価値観と整合する"],
    evidenceRefs: ["persona:ev:e1", "job:job:value:1"],
  },
  difficultyGap: {
    score: 35,
    reasons: ["実装経験から大きな準備ギャップはない"],
    evidenceRefs: ["job:job:req:1", "persona:ev:e2"],
  },
};

/** Job discovery provider payload (normalized by DiscoveryService afterwards). */
const jobSearchQuery = {
  keywords: "フロントエンド エンジニア",
  location: "",
  contractType: "",
  workHours: "",
};

/**
 * Persona update proposals must cite only allowed sources: the base
 * persona's own facts carried forward plus reflection-prefixed new
 * evidence (#13). The current persona arrives inside the prompt payload,
 * so its evidence is echoed verbatim — mirroring what the real model is
 * instructed to do.
 */
function personaUpdateProposalFor(userContent, rawBody) {
  // `userContent` is the prompt's user message: the JSON digest built by
  // PersonaUpdateService.propose.
  let current = null;
  try {
    current = JSON.parse(String(userContent ?? "{}"))?.currentPersona ?? null;
  } catch {
    current = null;
  }
  const baseEvidence = Array.isArray(current?.evidence) ? current.evidence : [];
  // The stored domain snapshot omits absent optional dates; the provider
  // schema requires the keys, so restore them as explicit nulls.
  const baseExperiences = Array.isArray(current?.experiences)
    ? current.experiences.map((experience) => ({
        startedOn: null,
        endedOn: null,
        ...experience,
      }))
    : [];
  // Extract the allowed reflection sourceId pinned to the proposal requestId (#166).
  // The system prompt contains `sourceId を "reflection:<requestId>" に固定`.
  // Fall back to the legacy hard-coded id for older clients.
  let reflectionSourceId = "reflection:e2e-update";
  try {
    const raw = String(rawBody ?? "");
    const match = raw.match(/reflection:[a-zA-Z0-9._-]{8,128}/);
    if (match) reflectionSourceId = match[0];
  } catch {
    // keep fallback
  }
  return {
    ...(current ?? personaSnapshot),
    experiences: baseExperiences,
    strengths: [
      ...(current?.strengths ?? []),
      "面接で確認できたデータへの興味",
    ],
    evidence: [
      ...baseEvidence,
      {
        id: "ev:reflection",
        sourceType: "user_input",
        sourceId: reflectionSourceId,
        summary: "面接ではデータ整備の話が深まりました。",
      },
    ],
    confidence: Math.min(1, Number(current?.confidence ?? 0.6) + 0.1),
  };
}

function payloadFor(schemaName, body, rawBody) {
  switch (schemaName) {
    case "persona_snapshot":
      return personaSnapshot;
    case "persona_update_proposal":
      return personaUpdateProposalFor(body, rawBody);
    case "job_snapshot":
      return jobPayloadFor(body);
    case "job_scoring":
      return scoring;
    case "job_search_query":
      return jobSearchQuery;
    default:
      return null;
  }
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || !request.url.includes("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    let schemaName = "";
    let userContent = "";
    try {
      const parsed = /** @type {any} */ (JSON.parse(body));
      schemaName = String(
        parsed?.response_format?.json_schema?.name ??
          parsed?.response_format?.name ??
          "",
      );
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      const lastUser = [...messages].reverse().find((m) => m?.role === "user");
      userContent = String(lastUser?.content ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const payload = payloadFor(schemaName, userContent, body);
    if (payload === null) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ unknown: true }) },
            },
          ],
        }),
      );
      return;
    }
    // Simulate realistic latency so pending states are observable.
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
      );
    }, 50);
  });
});

server.listen(PORT, () => {
  console.log(`[mock-llm] listening on http://localhost:${PORT}`);
});
