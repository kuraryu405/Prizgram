# Prizgram Architecture

## Goals

The initial architecture should support:

- conversational persona generation,
- explainable opportunity scoring,
- application-stage tracking,
- deadline-driven notifications,
- persistent user state,
- later addition of mock interview feedback and document drafting.

## Proposed stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS
- **Backend:** NestJS, TypeScript
- **Database:** PostgreSQL
- **LLM:** Claude API
- **Background processing:** queue / worker model

## Repository structure

```text
apps/
  web/       Next.js application
  api/       NestJS API and workers
packages/
  shared/    Shared TypeScript types, schemas, and utilities
docs/
  product.md
  architecture.md
```

## Core domains

### Persona

Represents the current structured understanding of a user.

Possible fields:

- skills,
- experience,
- values,
- preferred roles,
- preferred work style,
- strengths,
- weaknesses,
- evidence / provenance,
- confidence,
- updatedAt.

Persona updates should be traceable. Avoid overwriting the previous state without retaining evidence or history.

### Opportunity

Represents an internship or job opportunity.

Possible fields:

- company,
- role,
- requirements,
- desired skills,
- culture / values signals,
- selection process,
- deadlines,
- source and source permissions.

### MatchScore

Stores explainable scoring results rather than only a total score.

```ts
type MatchScore = {
  skillFit: ScoreDimension;
  cultureFit: ScoreDimension;
  readinessGap: ScoreDimension;
  generatedAt: string;
  personaVersion: string;
  opportunityVersion: string;
};

type ScoreDimension = {
  score: number;
  reasons: string[];
  evidenceIds: string[];
};
```

### Application

Tracks the user's selection process.

Possible states:

```text
saved
→ applying
→ submitted
→ screening
→ interview
→ offer
→ accepted / rejected / withdrawn
```

State transitions should be stored as history so outcomes can feed back into the persona model.

## Event-driven loop

Candidate domain events:

- `persona.updated`
- `opportunity.created`
- `opportunity.updated`
- `application.stage_changed`
- `application.outcome_recorded`
- `deadline.approaching`
- `mock_interview.analyzed`

Example flow:

```text
application.outcome_recorded
        ↓
extract learning signals
        ↓
update persona version
        ↓
re-score active opportunities
        ↓
update recommended next actions
```

## Data integrity principles

- Preserve persona versions and evidence provenance.
- Separate deterministic scoring inputs from generated explanations where possible.
- Record which persona and opportunity versions produced a score.
- Make LLM-derived fields distinguishable from user-provided or source-provided facts.
- Require explicit approval boundaries for external user-representing actions.

## Security and privacy considerations

Prizgram will handle potentially sensitive recruiting data. Before production use, the implementation should include:

- strict authorization boundaries,
- encrypted secrets and secure environment configuration,
- minimum-necessary retention of transcripts and application data,
- deletion/export flows,
- auditability of automated persona changes,
- prompt-injection resistance for externally sourced job text.

## MVP implementation order

1. Shared schemas and database model
2. Persona interview flow
3. Persona persistence/versioning
4. Opportunity ingestion interface
5. Explainable scoring pipeline
6. Application tracker
7. Deadline scheduler / notification events
8. Evaluation and telemetry
