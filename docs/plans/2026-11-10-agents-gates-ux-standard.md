# Agents, gates and UX standard — Plan (rev. 1, for the gate)

**Goal:** (A) a small team of named agents with fixed roles, models and efforts that the orchestrator
routes work between; (B) hooks that are real gates (they refuse, not warn); (C) a production UX/DX
standard for the web app, as a project skill that tests and lint enforce. Nothing is built before this
plan passes the gate (opus @ high ∥ gpt-6.1-sol @ high → final opus @ xhigh).

**Scope.** A and B-global live in `~/.claude/` (all projects). B-project and C live in this repo.

## 0. Verified facts (research 2026-11-10, primary sources)

| Fact | Source |
|------|--------|
| Agent frontmatter: `name`, `description` required; `tools`, `disallowedTools`, `model`, `effort` (low…max), `permissionMode`, `maxTurns`, `skills` (preloaded, ≤ 32), `mcpServers`, `hooks`, `memory`, `background`, `isolation: worktree`, `color`. Unknown fields are ignored silently. | code.claude.com/docs/en/sub-agents |
| `SendMessage` addresses an agent by ID or name and resumes a finished agent with its history; it works **without** agent teams; a message is task direction only (it cannot approve permissions). | sub-agents docs |
| Agent teams (lead + teammates + shared task list + mailbox) are **experimental**, need `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and an **interactive** session; one team per session; `skills` not applied to teammates. | code.claude.com/docs/en/agent-teams |
| Workflow: JS script, `agent()` / `parallel()` / `pipeline()`, results stay out of the main context, resumable in the same session; saved workflows run as `/<name>`. | code.claude.com/docs/en/workflows |
| Hooks block with exit 2 or JSON (`PreToolUse`: `hookSpecificOutput.permissionDecision: "deny"`; `Stop`: `decision: "block"` + `reason` makes Claude continue). Exit 2 on `PostToolUse` cannot undo the tool. | code.claude.com/docs/en/hooks |
| A Stop hook must exit 0 when `stop_hook_active` is true; Claude Code overrides a Stop hook after 8 blocks in a row. | hooks guide |
| A timed-out `PreToolUse` hook does **not** block unless `onFailure: "block"` (command/http hooks only). | hooks reference |
| Windows: match `Bash|PowerShell`; a hook that matches only `Bash` misses PowerShell calls. Exec form needs a real `.exe` → run hooks with `node`. | hooks guide |
| `prompt` and `agent` hook types exist; `agent` hooks are experimental (60 s, read-only tools). | hooks guide |
| Good Core Web Vitals at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. | web.dev/articles/vitals (2024, older) |
| `useOptimistic` shows the optimistic value only while the Action runs and falls back when it ends or throws. | react.dev/reference/react/useOptimistic |
| Lighthouse CI asserts per audit (`maxNumericValue`, `minScore`); `error` fails the job. Lab runs have no INP. | googlechrome.github.io/lighthouse-ci |
| `@axe-core/playwright` 4.14.0 (`AxeBuilder.withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`). | playwright.dev/docs/accessibility-testing |
| `eslint-plugin-jsx-a11y` 6.10.2 declares eslint `^3…^9`; this repo uses eslint 10.14. | npm registry |
| No ESLint plugin found that requires `loading.tsx` / `error.tsx` per route. | research, not confirmed absent |
| Existing global agents: `probe` (haiku), `doc-scribe` (haiku), `design-advisor` (opus, xhigh). The `Agent` tool has no `effort` parameter. | `~/.claude/agents/`, global CLAUDE.md |

**Unconfirmed — verify before the build (V-items):** V1 the `effort` option of Workflow `agent()`
(check the `workflow-authoring` skill); V2 the hook `if` field on compound commands under
PowerShell; V3 jsx-a11y under eslint 10 (peer range excludes it).

## 1. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | How do agents "talk"? | **The orchestrator routes.** Named agents report to the orchestrator; the orchestrator resumes a named agent with `SendMessage` (e.g. reviewer findings → the implementer). No agent teams (experimental, interactive only), no mailbox of our own. |
| D2 | Where does the effort tier come from? | Frontmatter `effort` (the `Agent` tool cannot set it). Cross-vendor reviews go through `delegate_task` (codex, gpt-6.1-sol, `reasoningEffort: high`). Multi-agent review chains run as a Workflow only when V1 confirms per-agent effort; else as `delegate_task` calls. |
| D3 | One reviewer file per lens? | No. One rubric skill `review-rubric`, two thin agents (`reviewer` @ high, `final-reviewer` @ xhigh) that preload it. The lens (spec / security) is in the prompt. |
| D4 | What is the real gate? | Server-side first: the `protect-main` ruleset and the `production` Environment reviewer already exist. Hooks are the local second line: they refuse early with a reason. A hook never replaces a server rule. |
| D5 | Stop hook cost | **Cheap checks only** (this PC blue-screened under load). Heavy suites stay in CI (required checks). |
| D6 | Optimistic updates | React 19 `useOptimistic` + Server Actions. No TanStack Query (not installed; add only when client-side caching is needed). |
| D7 | Web Vitals budget | Lab budget in CI (Lighthouse CI on the e2e production build); field data (INP) after P1a-3, when real riders exist. |

## 2. Layers and order

```
L1 global agents ──► L2 global hooks ──► L3 project UX standard (after P1a-1 merged: ci.yml)
```

Each layer is one batch: implementer → reviews (opus @ high ∥ gpt-6.1-sol @ high) → final opus @ xhigh.

### L1 — Named agents (`~/.claude/agents/`)

| Agent | Model / effort | Tools | Role |
|-------|----------------|-------|------|
| `probe` (exists) | haiku | read-only | heavy reading, verdicts |
| `doc-scribe` (exists) | haiku | Read, Edit, Write | docs from a settled brief, returns a diff |
| `design-advisor` (exists) | opus / xhigh | read-only | hard design forks |
| `implementer` (new) | opus / medium | all; `disallowedTools: Agent` | one batch, TDD, house commits, STOP & ASK on unexpected state; reads load rules from the project file |
| `reviewer` (new) | opus / high | Read, Grep, Glob, Bash; no Edit/Write | adversarial review, preloads `review-rubric` |
| `final-reviewer` (new) | opus / xhigh | same | final review before sign-off, preloads `review-rubric` |
| `release-gate` (new) | opus / high | Read, Grep, Glob, Bash | GO / NO-GO before a production deploy (§L2.3); writes only its verdict file |

- `review-rubric` skill (`~/.claude/skills/review-rubric/SKILL.md`): "don't trust the report — verify by
  reading the code and the CI run"; findings table (id, severity, file:line, failure scenario, fix);
  "none" when none.
- `orchestrated-delivery` skill: replace the ad-hoc prompts with the roster above and the routing rule D1
  (reviewer findings → `SendMessage` to the implementer by name → re-review by a **new** reviewer).
- **Done when:** a real small PR runs the loop with the named agents; the transcript shows the frontmatter
  model/effort (`claude --debug` flags no unknown field).

### L2 — Global hooks (`~/.claude/hooks/*.mjs`, `node`, matcher `Bash|PowerShell`)

1. **`guard-git.mjs` (PreToolUse).** Deny, with a reason:
   `git push` whose target is `main`/`master` (explicit refspec, `HEAD:main`, or no refspec while the
   current branch is the default); any `--force`/`-f`/`--force-with-lease` to the default branch;
   `--no-verify`; `git commit` on the default branch. Allow everything else.
2. **`merge-freeze.mjs` (PreToolUse).** While `<repo>/.git/ce-merge-freeze` exists (not committed),
   deny `gh pr merge` in that repo, with the file's text as the reason. This is the A5 freeze as a gate.
3. **`release-gate.mjs` (PreToolUse).** Deny `gh workflow run deploy-production*` unless
   `~/.claude/state/release-gate/<owner>-<repo>-<sha>.json` exists, says `GO`, names the same SHA and is
   < 24 h old. The `release-gate` agent writes it after it checks: the SHA is on `main`, CI is green on it,
   the staging promotion record exists, no open blocking review finding, CHANGELOG and
   `docs/progress.md` mention the release. The owner's Environment approval stays the final gate.
- `onFailure: "block"` on every gate hook (a crash refuses). Parse `tool_input.command` with a real
  tokenizer per shell (split on `;`, `&&`, `||`, `|`); an unparsable command touching `git push`/`gh` is
  denied.
- **Tests** (`node --test`, beside each hook): for each rule one must-deny and one must-allow input
  (stdin JSON), both shells. Mutation proofs: drop each rule, flip each comparison → a named test goes red.
- **Done when:** tests and mutations pass; a live try of each denied command in this session is refused
  with the reason; normal pushes to a feature branch still work.

### L3 — Project UX/DX standard (this repo)

1. **Skill** `.claude/skills/ux-standard/SKILL.md` (Spanish copy rules stay as they are):
   - every page segment that reads data has a skeleton (`loading.tsx` or a `<Suspense>` fallback) that
     keeps the final layout (no spinner, no layout shift); an `error.tsx` on its path; `not-found.tsx` for
     dynamic segments;
   - every list has three explicit states: loading (skeleton), empty (one line + the next action), error
     (`role="alert"`, Spanish, a retry);
   - mutations: optimistic with `useOptimistic` inside an Action; on failure the value falls back and a
     message shows; uploads show progress instead (no optimistic file);
   - a11y: WCAG 2.1 AA, labels on every control, focus visible, no colour-only state;
   - Web Vitals budget: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms (lab proxy for INP ≤ 200 ms).
2. **Enforcement:**
   - `scripts/check-route-states.mjs` (CI step in `check`): every `app/**/page.tsx` has a `loading.tsx`
     and an `error.tsx` in its segment or an ancestor; every `[param]` segment has a `not-found.tsx` on its
     path. Tests with fixture trees (missing → fails, present in an ancestor → passes).
   - **axe in e2e:** a Playwright fixture runs `AxeBuilder` (WCAG A/AA tags) on `/`, `/ingresar` (both
     steps) and the error page; zero violations. Mutation: remove a label → red.
   - **Lighthouse CI** in the `e2e` job on the production build: `categories:performance` ≥ 0.9,
     LCP ≤ 2500, CLS ≤ 0.1, TBT ≤ 200 (`error` level). Mutation: add a 300 KB script → red.
   - **jsx-a11y:** only if V3 passes (runs under eslint 10 without a peer override); otherwise skipped and
     recorded — axe is the gate.
   - `docs/features.json`: a CI step checks that every `test` proof file (and quoted title) exists.
3. **Project Stop hook** (`.claude/settings.json`): exits 0 when `stop_hook_active`; else, when the
   working tree changes files under `apps/`/`packages/`: `eslint` on the changed files only, the
   route-state check, and the features.json check. Blocks with the failures as `reason`. No typecheck,
   build or test suite (D5).
4. **Bring the app to the standard:** add `loading.tsx` (skeleton of the trail list) at the root; check
   `/ingresar` and the error page under axe and Lighthouse; fix what fails.
- **Done when:** CI runs the four checks as part of the required jobs; each check has a mutation that
  turns it red; the app passes them; `docs/features.json` lists the standard.

## 3. Out of scope (cut)

Agent teams and our own mailbox (D1); `agent`-type hooks (experimental, and a timeout does not block);
TanStack Query (D6); field Web Vitals reporting before production; a hook that runs test suites (D5).

## 4. Open questions for the gate

1. Is "orchestrator routes, `SendMessage` resumes" enough for "agents that talk to each other", or is a
   peer-to-peer channel needed now?
2. Is a local `release-gate` file worth it next to the Environment reviewer, or is it ceremony?
3. Lighthouse CI on the CI runner: stable enough for `error` level, or `warn` first for one week?
