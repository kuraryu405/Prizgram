# Prizgram Product Overview

## Problem

Japan's internship and new-graduate recruiting market has a structural information-access gap.

Students with strong alumni networks, career-support communities, or established recruiting know-how can access practical guidance on company research, selection preparation, and application writing. Students without those networks often cannot access guidance of the same quality.

Many existing services primarily optimize discovery and matching. Prizgram instead focuses on continuously updating the user's self-understanding from real selection outcomes and using that updated model in future decisions.

## Target users

Primary users are students who have limited access to systematic recruiting support, including:

- students at regional universities or outside information-related majors,
- students going through recruiting or internship selection for the first time,
- students who have difficulty articulating their experience and strengths,
- students with limited access to career centers, alumni, or recruiting communities.

## Product concept

Prizgram creates a provisional structured career persona through conversation, then uses it to score internships and job opportunities.

The persona is not static. Application outcomes, mock interview feedback, and new user information update the model over time so that matching and guidance can improve continuously.

## MVP scope

### 1. Persona generation

Convert conversational interviews into structured data covering:

- experience,
- skills,
- values,
- preferences,
- strengths,
- weaknesses.

### 2. Explainable opportunity scoring

Compare the persona with opportunities using multiple dimensions rather than one opaque overall percentage.

Initial dimensions:

- skill requirement fit,
- culture / values fit,
- selection difficulty vs. current readiness.

Every score should retain supporting reasons or evidence.

### 3. Application tracking and reminders

Track:

- company / role,
- application status,
- ES deadline,
- interview schedule,
- offer deadline,
- next action.

When deadlines overlap, prioritize notifications by urgency.

## Phase 2

### Mock interview feedback

Analyze mock interview transcripts and provide feedback on:

- strengths,
- improvement points,
- recurring speaking habits,
- evidence that may update the persona.

Real company interviews are not a target for recording or analysis without proper consent.

### Application document drafts

Generate ES and motivation-letter drafts from the persona and opportunity requirements. The user is responsible for final wording and submission.

## Agent behavior

Prizgram should qualify as an agent through four properties:

1. **Autonomy** — events such as new opportunities, selection results, and approaching deadlines can trigger processing automatically.
2. **Multi-step planning** — interview → structuring → matching → feedback ingestion → re-matching.
3. **Tool use** — opportunity search, transcript analysis, draft generation, reminders, and related tools.
4. **Persistent state** — persona and selection history are stored and evolve over time.

## Guardrails

### No automatic application submission

Application submission is an external act representing the user. It must require explicit user approval and manual final action.

### Explainable scoring

Do not expose only a black-box match percentage. Store and display score dimensions and supporting reasons.

### Interview recording

Mock interview analysis is in scope. Unauthorized recording of actual company interviews is out of scope.

### Data acquisition

Opportunity data should be obtained only from official APIs, permitted data sources, or other explicitly authorized methods.

## Success measurement

Potential validation metrics include:

- change in ES screening pass rate,
- reduction in missed deadlines,
- improvement in users' ability to articulate strengths,
- recommendation acceptance / save rate,
- changes in scoring calibration after feedback loops.

These metrics are hypotheses for future validation rather than established impact claims.
