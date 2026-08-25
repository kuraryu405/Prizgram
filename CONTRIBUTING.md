# Contributing to Prizgram

Prizgram is currently in the MVP phase. Keep changes small, reviewable, and tied to a concrete product or engineering goal.

## Branches

Use short-lived branches from `main`.

Suggested prefixes:

- `feat/` — user-facing features
- `fix/` — bug fixes
- `docs/` — documentation
- `refactor/` — behavior-preserving refactors
- `chore/` — tooling and maintenance

## Pull requests

A pull request should:

- describe the user or engineering problem,
- explain the chosen approach,
- include tests when behavior changes,
- document schema or architecture changes,
- avoid unrelated refactors,
- preserve Prizgram's human-in-the-loop boundaries.

## Product guardrails

Changes must not silently introduce:

- automatic application submission,
- opaque single-score recommendations without explanation,
- unauthorized recording or analysis of real company interviews,
- unapproved scraping or acquisition of job data.

If a feature changes one of these boundaries, discuss and document the decision before implementation.
