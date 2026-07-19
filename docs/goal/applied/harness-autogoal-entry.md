# goal: harness-autogoal-entry

## One-line Goal
Make `/autogoal` the single development entry point by archiving the superseded harness entry commands, and sync every remaining reference so the slimmed structure (autogoal = door, harness = engine, hooks = safety) runs cleanly.

## Background / Motivation
A 4-lens panel + cross-examination audit (this session, 2026-07-19) confirmed: the goal-doc flow replaced meeting/dev-cycle flows in mid-June (47 vs 7 applied docs, zero meeting/dev-cycle usage since 2026-06-17), and autogoal now embeds LIGHT/HEAVY routing plus a planning panel — leaving the role-play meeting variants, `/build`, and `/dev-cycle` with no remaining job. The harness itself (triage + hooks + Scout→Coder→Reviewer(→QA) pipeline) stays as the execution engine that autogoal Phase 6 rides.

## In-scope
- Archive project commands to `docs/harness/archive/commands/`: `build.md`, `dev-cycle.md`, `meeting.md`, `meeting-light.md`, `meeting-multi.md`, `meeting-team.md`, plus support file `.claude/meeting-team-profiles.md`
- Move 16 completed impl docs `docs/meeting/impl/*.md` → `docs/meeting/applied/` (dead-letter cleanup of the archive rule)
- Remove the `audit-counter` SessionStart hook from `.claude/settings.json`; archive `audit-counter.sh` to `docs/harness/archive/hooks/`
- Reference sync: `CLAUDE.md` Brain table (drop archived rows, add `/autogoal` entry row, note the archive), `.claude/skills/harness/SKILL.md` frontmatter `name: build` → `harness`, `.claude/skills/README.md` reframed (skill-*.md now feed harness agents, not meeting-team/dev-cycle)

## Out-of-scope
- User-level global commands (`~/.claude/commands/meeting-agent|multi|team.md`) — global scope, other projects may use them
- `meeting-codex.md` — kept (referenced by autogoal Phase 3.5 as the alternative panel execution)
- Merging `workflow.md` into `harness.md` — deferred, cosmetic
- `agents/*.md` staleness fixes (game list, ports) — separate task
- Deleting anything — archive-only, git history preserved via `git mv`

## Acceptance Criteria
- [ ] 6 command files + profiles file exist under `docs/harness/archive/commands/` and are gone from `.claude/`
- [ ] `docs/meeting/impl/` is empty; `docs/meeting/applied/` gained 16 files
- [ ] `settings.json` has no SessionStart block and parses as valid JSON
- [ ] Grep for archived command names over active `.claude/**/*.md` + `CLAUDE.md` returns no dangling references (meeting-codex excluded)
- [ ] Next session's skill listing no longer registers project-level `/build`, `/dev-cycle`, `/meeting`, `/meeting-light`, `/meeting-multi`, `/meeting-team`

## Related Files / Modules
| File | Role |
|------|------|
| `.claude/commands/{build,dev-cycle,meeting,meeting-light,meeting-multi,meeting-team}.md` | Superseded entry points → archive |
| `.claude/meeting-team-profiles.md` | meeting-team personas → archive |
| `.claude/hooks/audit-counter.sh` + `.claude/settings.json` | Session-counter hook → deregister, archive script |
| `docs/meeting/impl/*.md` (16) | Completed impl docs → `applied/` |
| `CLAUDE.md`, `.claude/skills/harness/SKILL.md`, `.claude/skills/README.md` | Reference sync |

## Must-Preserve
- `meeting-codex.md` and its references (`workflow.md` planning pipeline section) stay intact
- `harness.md`, `workflow.md`, all hooks except audit-counter, `agents/*.md`, lessons — untouched
- `skill-*.md` files stay (injected into harness agents: `reviewer.md` frontmatter, harness SKILL.md 참조 스킬 section)
- goal-archive Stop hook flow keeps working (queue append only on completion)

## Execution Notes
- Recommended model: mechanical moves + doc edits — any current model acceptable (session runs Claude Fable 5; Sonnet acceptable).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
