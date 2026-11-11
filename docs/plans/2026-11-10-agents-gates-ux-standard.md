# Agents, gates and UX standard — Plan (rev. 3, gate closed; §6 amendments are BINDING)

**Goal:** (A) a small team of named agents with fixed roles, models and efforts that the orchestrator
routes work between; (B) local guards that refuse early, behind the server gates that decide; (C) a
production UX/DX standard for the web app, as a project skill that CI tests enforce. Nothing is built
before this plan passes the gate.

**Scope.** A and the global guard live in `~/.claude/`. The pre-commit hook and C live in this repo.

**Revision 2** applies the gate (opus 5.5 @ high ∥ gpt-6.1-sol @ high, both "request changes", 4 and 7
blocking items). Ledger in §5. Cut: the release-gate hook, file and agent; the merge-freeze hook; the
shell tokenizer; the push-to-main local rule; the Stop hook; the route-state filename checker; Workflow
for the review chain.

## 0. Verified facts

| Fact | Source |
|------|--------|
| Agent frontmatter: `name`, `description` required; also `tools`, `disallowedTools`, `model`, `effort`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation`, `color`, `autoCompactWindow`, `omitClaudeMd`, `initialPrompt`. `claude --debug` logs "does not recognize or apply" for an unknown field. | code.claude.com/docs/en/sub-agents |
| The `Agent` tool takes a per-call `effort` (Claude Code ≥ 2.1.292; installed 2.1.322). `CLAUDE_CODE_EFFORT_LEVEL` overrides frontmatter and per-call effort. | sub-agents docs; this session's Agent tool schema |
| `SendMessage` addresses an agent by ID or name and resumes a finished agent with its history; it works without agent teams. | sub-agents docs |
| `~/.claude/settings.json` sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. With it, a **named** launch in an interactive CLI session starts a **teammate**, and teammates do not get the definition's `skills`. In an SDK host (T3) a named launch stays a subagent. | code.claude.com/docs/en/agent-teams; local settings |
| A project `Stop` hook does not fire for subagents (`SubagentStop`), teammates or codex children; `stop_hook_active` is true on every stop after a continuation. Stop is feedback, not a durable gate. | code.claude.com/docs/en/hooks |
| `PreToolUse` deny: `hookSpecificOutput.permissionDecision: "deny"` or exit 2. `onFailure: "block"` (≥ 2.1.295, command/http hooks) blocks on crash, timeout or bad output. A command string hook can be bypassed by scripts, other interpreters and APIs. | hooks reference; both reviews |
| The `production` GitHub Environment does **not** exist yet (only `staging`). `protect-main` is active, requires `check`, `contract`, `e2e`, `images`, and has no bypass actors (removed 2026-11-10). | GitHub API |
| `loading.tsx` wraps the page below its layout, not the layout; root `error.tsx` does not catch root-layout errors (`global-error.tsx` does); `not-found.tsx` renders only on `notFound()` or an unmatched URL. The root layout awaits `SessionHeader` (`getMe`, up to 5 s). | nextjs.org docs (loading, error, not-found); `apps/web/src/app/layout.tsx` |
| `useOptimistic` shows the optimistic value while the Action runs; it settles to the new state on success and to the old one on failure. It does not need a Server Action. | react.dev/reference/react/useOptimistic |
| Good Core Web Vitals at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Lab runs have no INP; TBT only correlates. | web.dev/articles/vitals (2024); web.dev/articles/tbt |
| LHCI asserts per audit (`maxNumericValue`, `minScore`, levels `error`/`warn`), aggregation default is optimistic; `upload.target: filesystem` keeps reports private. | googlechrome.github.io/lighthouse-ci |
| `@axe-core/playwright` 4.14.0; axe covers part of WCAG only (no focus visibility, no keyboard order). | playwright.dev/docs/accessibility-testing |
| `eslint-plugin-jsx-a11y` 6.10.2 (latest) supports eslint ≤ 9; this repo uses eslint 10 → **skipped**, axe is the gate. | npm registry |
| The shared ESLint config uses typed rules (`projectService`): a lint run builds a TS program — heavy on this PC. | `packages/config` |

## 1. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | How do agents "talk"? | The orchestrator routes. It keeps each run's agent ID, resumes the implementer with `SendMessage`, and starts a **new** reviewer for each re-review. Agent teams off (§L1.1). No peer-to-peer channel until two implementers must change the same files at once (the batch rule prevents that). |
| D2 | Effort tier | Frontmatter `effort`; the per-call `effort` overrides only when the call needs another tier. Cross-vendor reviews: `delegate_task` (codex, gpt-6.1-sol, `reasoningEffort: high`). No Workflow for the review chain. |
| D3 | Reviewer files | One rubric skill `review-rubric`, two thin agents (`reviewer` @ high, `final-reviewer` @ xhigh) that preload it. The lens is in the prompt. |
| D4 | What is the gate? | Server-side only: `protect-main` (no bypass) for merges; for production, the `production` Environment (created in P1a-3, owner = required reviewer) **plus a `preflight` job** in `deploy-production.yml` (SHA on `main`, CI green on it, a staging promotion record, CHANGELOG mentions it) that the Environment job `needs`. Local hooks are accident guards with a stated coverage limit, never a security boundary. |
| D5 | Merge freeze (A5 and later) | Server-side: the operator turns on the `protect-main` "restrict updates" rule for the freeze and turns it off for the one planned merge; before the freeze, list and disable pending auto-merges. No local hook. |
| D6 | Local checks | A git `pre-commit` hook (catches every committer: me, subagents, codex children) that runs cheap `node` scripts only. No ESLint, typecheck, build or tests locally (D-load: this PC blue-screened under load); CI stays authoritative. |
| D7 | Mutations | Every mutation shows pending and error feedback. Optimistic UI only for reversible state changes (e.g. a favourite), with success reconciliation and a failure test. Never for the OTP send or uploads. No TanStack Query. |
| D8 | Web Vitals | Lab budget in CI on `/` only; field data after production. |

## 2. Layers and order

```
L1 global agents ──► L2 global guard ──► L3 project standard (needs: P1a-1 merged (ci.yml), PR #15 merged)
```

Each layer is one batch: implementer → reviews (opus @ high ∥ gpt-6.1-sol @ high) → final opus @ xhigh.
P1a-3 gets the D4 `preflight` job (added to issue #10), not this plan.

### L1 — Named agents (`~/.claude/agents/`)

1. **Agent teams off:** remove `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` from `~/.claude/settings.json`.
2. Roster:

| Agent | Model / effort | Tools | Role |
|-------|----------------|-------|------|
| `probe` (exists) | haiku | Read, Grep, Glob, Bash | heavy reading, verdicts |
| `doc-scribe` (exists) | haiku | Read, Grep, Glob, Edit, Write | docs from a settled brief, returns a diff |
| `design-advisor` (exists) | opus / xhigh | Read, Grep, Glob, Bash | hard design forks |
| `implementer` (new) | opus / medium | all; `disallowedTools: Agent, mcp__t3-code__delegate_task` | one batch, TDD, house commits, STOP & ASK on unexpected state; load rules from the project file |
| `reviewer` (new) | opus / high | Read, Grep, Glob, Bash | adversarial review; `skills: [review-rubric]` |
| `final-reviewer` (new) | opus / xhigh | Read, Grep, Glob, Bash | final review before sign-off; `skills: [review-rubric]` |

   "Read-only" for agents with `Bash` is a behavioural rule in the prompt, not enforced (recorded).
3. `review-rubric` skill: verify by reading the code and the CI run, not the report; findings table (id,
   severity, file:line, failure scenario, fix); "none" when none.
4. Update the global `CLAUDE.md` + `~/.codex/AGENTS.md` (together, as the owner's rule says): the
   `Agent` tool takes `effort`; the roster replaces ad-hoc prompts. Update `orchestrated-delivery` with D1.
- **Done when:** one real small PR runs the loop: `reviewer` started by name in a CLI session gets the
  rubric (its output uses the table) and runs at high (`claude --debug` shows the model/effort and no
  unknown field); the same in T3.

### L2 — Global accident guard (`~/.claude/hooks/guard.mjs`)

1. One `PreToolUse` hook, matcher `Bash|PowerShell`, `if` filters `Bash(git *)`, `Bash(gh *)` and the
   PowerShell equivalents, `timeout: 5`, `onFailure: "block"`, exec form `node <path>`; Claude Code ≥ 2.1.295.
2. Regexes on the raw command string (both shells). Deny with a reason: `git push` with a force flag
   (`-f`, `--force`, `--force-with-lease`, `+<ref>`), `--mirror`, `--delete` or `:<ref>`; `git commit`
   with `--no-verify` or `-n`; `git push --no-verify`. Everything else passes to the normal permission
   checks. Pushes to `main` stay allowed locally: rulesets refuse them where a repo protects `main`, and
   some repos push to their default branch by design.
3. **Tests** (`node --test`): per rule one must-deny and one must-allow input, both shells; registration
   and failure tests (missing script, crash, timeout, bad output → refused). Mutation proofs: drop each
   rule, weaken each regex → a named test goes red. Install the hook only after the tests pass.
- **Done when:** tests and mutations pass; a live try of each denied command runs in a **scratch repo
  with a local bare remote** and is refused; a normal push there works.

### L3 — Project UX/DX standard (this repo)

1. **Skill** `.claude/skills/ux-standard/SKILL.md`:
   - each data route has **its own** skeleton (segment `loading.tsx` or `<Suspense>` in the page) in the
     final layout (no spinner, no shift); async work in a layout sits in `<Suspense>` with a fixed-height
     fallback; `global-error.tsx` for root-layout failures; a Spanish root `not-found.tsx`; dynamic routes
     call `notFound()` for a missing resource;
   - every list: loading (skeleton), empty (one line + the next action), error (`role="alert"`, Spanish,
     retry);
   - mutations per D7;
   - a11y: WCAG 2.1 AA target; labels, visible focus, keyboard order, no colour-only state; axe + one
     keyboard test per flow + a short manual check per release;
   - Web Vitals budget per D8.
2. **Bring the app to the standard:** `<Suspense>` around `<SessionHeader/>` in the root layout; the
   trail-list skeleton in the home segment only; `global-error.tsx`; a Spanish root `not-found.tsx`.
3. **Behaviour tests (e2e, existing stack):**
   - with the hung API (ports 3103/3104): `/` shows its list skeleton, then the Spanish error page;
     `/ingresar` renders without the trail skeleton; a slow `/api/me` does not blank the page;
   - an unmatched URL → the Spanish not-found page (404); a missing-slug test arrives with the first
     `[param]` route;
   - `a11y.spec.ts` (built on the `turnstile.ts` `test`): explicit axe scans (WCAG A/AA tags) after the
     state assertions on `/` (filled and empty list), `/ingresar` step 1 and step 2, and the error page;
     zero violations; one keyboard test of the sign-in flow (tab order, visible focus).
   - Mutations: remove every accessible-name source of one control → red; remove the `<Suspense>` around
     `SessionHeader` → the slow-`/api/me` test red; remove the home skeleton → red.
4. **Lighthouse CI** (a separate step in the `e2e` job, after Playwright): start API + web + proxy
   explicitly (readiness wait, cleanup), seeded DB, Playwright's Chromium (`chromePath`), audit `/` only,
   block `challenges.cloudflare.com`, 3 serial runs, `aggregationMethod: median`,
   `upload.target: filesystem`, pinned `@lhci/cli`. Config/collection failure is fatal.
   - `error` from day one: CLS ≤ 0.1, `resource-summary:script:size` and `total-byte-weight` budgets
     (set from the first measured baseline + 10 %).
   - `warn` first: performance ≥ 0.9, LCP ≤ 2500 ms, TBT ≤ 200 ms. **Named trigger:** promote to `error`
     when both hold — 10 consecutive green `main` runs inside the budget and the date 2026-11-24 has passed.
   - Mutations: add bytes over the script budget → red; inject a layout shift over 0.1 → red.
5. **`pre-commit` hook** (`.githooks/pre-commit`, `core.hooksPath` set by the root `prepare` script):
   `node scripts/check-features.mjs` — `docs/features.json` parses, every `test` proof file exists and
   its quoted title is a `test(` title in that file (not a comment); and when staged files touch `apps/`
   or `packages/`, `CHANGELOG.md` is staged too. Deleted files are ignored. The same script runs in the
   CI `check` job (authoritative). Tests: both sides of each rule.
- **Done when:** CI runs the behaviour tests, axe and LHCI as part of the required jobs; each mutation
  turns a named check red (recorded, code restored); the app passes; `docs/features.json` lists the
  standard with its proofs.

## 3. Out of scope (cut)

Agent teams; a peer-to-peer channel; a local release gate; a merge-freeze hook; a shell tokenizer; a
local push-to-main rule; a Stop hook; a route filename checker (until the route count grows);
`agent`-type hooks; TanStack Query; jsx-a11y; field Web Vitals before production.

## 4. Gate answers (rev. 1 §4)

1. Orchestrator routing + `SendMessage` is enough (both).
2. The local release file is ceremony (both) → D4 `preflight` job in P1a-3.
3. Hard budgets only for the stable metrics; timing metrics `warn` until the named trigger (opus: ≥ 10
   green runs; gpt: a dated week) — both conditions.

## 5. Gate ledger (rev. 1 → rev. 2)

| Finding | Source | Where fixed |
|---------|--------|-------------|
| Agent teams env already on → named reviewer loses its skills | both (blocking) | §0, L1.1 |
| Stop hook: `stop_hook_active` exit, no subagent coverage, typed ESLint is heavy | both (blocking) | D6, L3.5; Stop hook cut |
| Release gate forgeable, bypassable, target not existing | both | D4, cut |
| Production Environment does not exist | gpt (blocking) | §0, D4 (P1a-3) |
| Shell tokenizer cannot be a boundary; push destination needs ref resolution | both (blocking) | L2.2 regex accident guard; push-to-main cut |
| Merge freeze hook bypassable | both | D5 server-side |
| Global push-to-main deny breaks repos that push to master | opus | L2.2 |
| Root `loading.tsx` does not cover the layout; wrong skeleton on `/ingresar`; root-layout errors | both (blocking) | L3.1-3 |
| Filename checker gives false confidence | both | cut; behaviour tests |
| Agent tool has per-call effort (stale fact) | gpt | §0, D2, L1.4 |
| `onFailure` runtime + integration tests; one hook, `if`, timeout | both | L2.1, L2.3 |
| Live denied-command tries could hit the real remote | opus | L2 done-when |
| LHCI server lifecycle, Turnstile, public upload, aggregation, calibration | both | L3.4 |
| Weak mutations (300 KB script, label text) | both | L3.3-4 |
| features.json check: dependency on #15, weak title match | both | §2 order, L3.5 |
| Optimistic rule too broad; `useOptimistic` fact | gpt / opus | D7, §0 |
| axe scans at explicit states; focus/keyboard not covered | both | L3.3 |
| Reviewer `Bash` is not read-only; implementer can delegate via T3 | both | L1.2 |
| jsx-a11y peer range | opus | §0 skipped |

## 6. Rev. 3 amendments — BINDING (they replace any conflicting text above)

From the final review (opus 5.5 @ xhigh, approve with changes, 2 blocking).

**R1 (blocking) — `prepare` must not break the image build (L3.5).** The Dockerfiles run
`pnpm install` on `node:24-alpine` without git and without `.git` in the context. The root `prepare` is
`node -e "require('fs').existsSync('.git')&&require('child_process').execSync('git config core.hooksPath .githooks')"`
(`.git` is a file in a worktree, so it still runs there). `git add --chmod=+x .githooks/pre-commit`.

**R2 (blocking) — the CHANGELOG rule is per PR, in CI only (L3.5).** House practice adds the entry once
per PR (25 of the last 32 code commits on main have none). The pre-commit hook runs only the
`features.json` check. The CHANGELOG rule runs in the CI `check` job on `pull_request` only
(`fetch-depth: 2`, `git diff --name-only HEAD^1 HEAD` on the merge ref): a diff touching `apps/` or
`packages/` must include `CHANGELOG.md`. Tests for both sides.

**R3 — guard registration and parsing (L2).** `if` holds one rule: two handlers with the same script,
`Bash(git *)` and `PowerShell(git *)`; no `gh`. Parsing: blank out `'…'`, `"…"` and heredoc bodies, split
on `;` `&&` `||` `|` and newlines, match `git( -[cC] \S+)* (push|commit|config)` per segment, flags as
whole tokens (`-[a-z]*f[a-z]*` only as a push flag token, `--force*`, `-d`, `--delete`, `--mirror`,
`\s:\S`, `\s\+\S`; commit `-n`/`--no-verify`); also deny `-c core.hooksPath=…` and
`git config … core.hooksPath`. Tests (must-deny / must-allow) include: `git commit -m "fix -n flag"`,
`git commit -m "deny git push --force"`, a heredoc body, `git push -u origin fix-flaky`,
`git push --follow-tags`, `git -C repo push --force`, `git push -d origin x`,
`git -c core.hooksPath=/dev/null commit`, `git config --unset core.hooksPath`. `node --test` covers
decisions only; registration and the four `onFailure` modes are live tries in the scratch repo, in the
CLI and in T3, including `cd x && git push -f` and `Set-Location x; git push -f`. If the PowerShell
compound try is not refused, drop `if` from that handler.

**R4 — L1 proof.** The rubric's last line is the canary `rubric: v1` (named by no prompt): the named
`reviewer` prints it, `probe` with the same prompt does not. Model and effort are read from the
subagent transcript (`~/.claude/projects/<p>/<session>/subagents/agent-<id>.jsonl`); `--debug` only for
unknown fields. Rubric path `~/.claude/skills/review-rubric/SKILL.md`. Remove `teammateMode` with the
teams env. Implementer `disallowedTools` adds `Workflow`, `mcp__t3-code__t3_thread_launch`,
`mcp__t3-code__create_threads`.

**R5 — skeleton placement (L3.2-3).** Home skeleton = `<Suspense>` inside `app/page.tsx`; **no**
`app/loading.tsx`. Mutation: move it to `app/loading.tsx` → the `/ingresar` test must go red, else delete
that test. `global-error.tsx` is cut until the root layout can throw (`getMe` catches every error).
Skill rule: a `[param]` route loads its resource **before** its first Suspense boundary, so a missing
resource returns HTTP 404 (a streamed `notFound()` returns 200); the missing-slug test asserts 404.
Record: `/` returns 200 when the API is down, so monitors use `/api/health`. The slow-header test sends
a session cookie (the 5 s wait happens only with one).

**R6 — axe scope (L3.3).** No empty-list scan (the list is fetched on the server; the seed has two
published trails). Move `requestCode` and `freshIp` to an e2e helper for the step-2 scan.

**R7 — LHCI inside Playwright (L3.4).** A last spec `lighthouse.spec.ts` runs `lhci collect` + `lhci
assert` via `execFileSync` while Playwright's servers are up: `chromePath = chromium.executablePath()`,
`--headless=new --no-sandbox`, URL `http://127.0.0.1:3100/`, 3-minute timeout. No Cloudflare block.
Median LCP, TBT and performance go to `$GITHUB_STEP_SUMMARY` and `.lighthouseci/` is uploaded as an
artifact; an issue dated 2026-11-24 tracks the promotion trigger.

**R8 — merge freeze (D5).** A separate ruleset `freeze-main` (`~DEFAULT_BRANCH`, one `update` rule, no
bypass), kept `disabled`; never edit `protect-main` for a freeze. Sequence: active (freeze) → disabled →
merge the planned PR → active → verify its deploy → disabled. Rehearse once with a throwaway PR
(`gh pr merge` refused). `allow_auto_merge` is false (confirm; no drain step). Applies to the P1a-1 A5
switch.

**R9 — preflight items (D4, P1a-3).** The staging item is "the `deploy-staging` job for that SHA
succeeded" (Actions API). The CHANGELOG item is cut. Final list in issue #10.

**R10 — small.** features.json title match: a `test(` or `it(` literal equal to the title, read from the
index (`git show :<path>`). §0 adds: frontmatter `experimental`; `if` holds one rule.
