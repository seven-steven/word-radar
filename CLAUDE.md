# word-radar

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (seven-steven/word-radar) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Using the default five-label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Design system

Target visual spec: `docs/design/DESIGN.md` (Google design.md format — Berkeley-Mono-only typography, warm cream canvas, near-black ink, ASCII bracket markers, hairline sections). New and redesigned surfaces follow it, not the current popup's issue #35 clean-SaaS CSS — that shipped look is pre-migration legacy, treat it as evidence only. impeccable commands need `--target docs/design/DESIGN.md` (their default lookup is the project root).
