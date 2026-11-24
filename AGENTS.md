# Agent workflow

## Preferences across versions

- Preserve user preferences across all version updates unless the user explicitly requests a change or reset.
- When exporting a fresh local Beta from Dev, carry over Dev preferences, including database UI settings (zoom/theme) and browser local storage (panel widths). Do not strip preferences from the Beta seed.
- Subsequent updates must retain the installed preferences instead of replacing them with defaults or a newer Dev profile. Keep a rollback backup before replacing a profile; preserve project files and recovery data.
- Verify code, catalogue, and preference parity separately. A matching bundle alone does not establish parity with the running Dev app.

## Approval gates

- Do not create, edit, delete, rename, or commit files without the user's explicit approval for the specific implementation task. Read-only investigation and proposals do not require implementation approval.
- Before implementation, present the proposed scope, likely affected files, validation plan, and a usage-aware model and reasoning-effort recommendation.
- Once the user explicitly approves implementation, complete the approved scope autonomously, including appropriate verification and a local git commit.
- Do not push commits without explicit push approval. Before asking for it, provide a concise change summary, test results, a manual-test checklist, and the proposed branch and remote target.
- After explicit push approval, push the approved commits. A passing PR may then be merged without another approval.
- Preserve unrelated user changes. Do not amend, reset, force-push, or discard them unless explicitly authorized.

## Task proposals

For each proposed implementation task, state:

1. Goal and scope.
2. Files likely affected.
3. Validation plan.
4. Recommended model and reasoning effort, based on expected complexity, risk, and usage.
5. A lower-cost alternative when appropriate.
6. An explicit request for implementation approval.

## Model and effort guidance

Favor the lowest-cost option likely to complete the task reliably. Increase effort when ambiguity, risk, or cross-cutting impact warrants it. Check currently available models before making a specific recommendation; the examples below may change over time.

| Task profile | Example recommendation |
| --- | --- |
| Tiny, localized edit with straightforward verification | `gpt-6-luna`, low or medium |
| Standard feature, bug fix, or refactor | `gpt-6.1-sol`, medium |
| Multi-file change, tricky debugging, migration, or careful review | `gpt-6.1-sol`, high |
| Architecture, security-sensitive work, or ambiguous high-impact behavior | `gpt-6-astra`, high or xhigh |

## Development references

See [README.md](README.md), [STATUS.md](STATUS.md) and
[docs/VERIFICATION.md](docs/VERIFICATION.md).
