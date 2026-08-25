# Prizgram

> **A personal career agent that learns from every selection.**

Prizgram is an AI-powered personal career agent for students navigating internships and new-graduate recruiting in Japan.

Instead of stopping at job search or one-shot matching, Prizgram continuously updates a structured career persona from conversations and selection outcomes, then uses that evolving context to improve future recommendations.

## Why Prizgram?

Access to recruiting knowledge is uneven. Students with strong alumni networks, career support, or established recruiting communities can obtain practical advice that others cannot.

Prizgram is designed to narrow that gap by turning fragmented experiences into an evolving personal model that helps users understand:

- what they are good at,
- what kind of company or role fits them,
- where the current gap is,
- and what they should do next.

## Core loop

```text
Interview / conversation
        ↓
Structured persona
        ↓
Job & internship scoring
        ↓
Application / selection result
        ↓
Feedback & persona update
        ↺
```

The product is built around this feedback loop: every new result should make the next recommendation more useful.

## MVP

The initial MVP focuses on three capabilities:

1. **Persona generation**  
   Extract experience, skills, values, preferences, strengths, and weaknesses through conversational interviews.

2. **Explainable opportunity scoring**  
   Compare the persona with job or internship requirements and show multiple scoring dimensions with reasons rather than a single opaque match percentage.

3. **Selection tracking & reminders**  
   Manage applications, stages, interviews, ES deadlines, and offer-response deadlines in one place, then surface the most urgent next actions.

## Planned capabilities

After validating the MVP:

- mock interview transcription and feedback,
- persona updates from interview feedback,
- ES / motivation-letter draft generation,
- automatic re-scoring when the persona or opportunity data changes,
- event-driven reminders for deadlines and new opportunities.

## Explainability by design

Prizgram avoids reducing users to a single unexplained score. Opportunity matching is intended to expose separate dimensions such as:

- skill requirement fit,
- culture / values fit,
- gap between current readiness and selection difficulty,
- supporting evidence for each score.

## Human-in-the-loop boundaries

Prizgram can autonomously organize information, score opportunities, generate reminders, and prepare drafts. External actions that represent the user require explicit human approval.

In particular:

- Prizgram **does not automatically submit applications**.
- Generated application documents are drafts; the user makes the final edits and submission decision.
- Interview analysis is intended for mock interviews, not unauthorized recording of real company interviews.
- Job data should come from official APIs or otherwise permitted sources.

## Architecture

Initial technical direction:

| Layer | Stack |
| --- | --- |
| Web | Next.js / TypeScript / Tailwind CSS |
| API | NestJS / TypeScript |
| Database | PostgreSQL |
| LLM | Claude API |
| Async jobs | Queue-based event processing |

A monorepo layout is planned:

```text
prizgram/
├── apps/
│   ├── web/        # Next.js frontend
│   └── api/        # NestJS backend
├── packages/
│   └── shared/     # Shared schemas, types, utilities
└── docs/
    ├── product.md
    └── architecture.md
```

## Product principles

1. **Learn continuously** — selection outcomes update the user's model.
2. **Explain recommendations** — expose reasons, not only scores.
3. **Keep agency with the user** — the agent assists; the user decides and submits.
4. **Minimize unfair advantage gaps** — make structured recruiting support accessible beyond strong personal networks.
5. **Measure impact** — validate whether the product actually improves outcomes rather than assuming usefulness.

## Status

**Early-stage / MVP planning**

The current repository contains the initial product and architecture documentation. Implementation will follow the MVP scope above.

## Documentation

- [`docs/product.md`](docs/product.md) — product scope, users, features, and guardrails
- [`docs/architecture.md`](docs/architecture.md) — initial system design and domain model

## License

No open-source license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
