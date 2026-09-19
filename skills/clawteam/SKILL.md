---
name: clawteam
description: "Nexus System multi-agent worker spawning through ClawTeam-OpenClaw. Use when Kit needs to split a larger task across multiple isolated workers, coordinate dependencies, collect results, and merge completed work back into the active repository. OpenClaw remains the persistent gateway; ClawTeam workers are on-demand and temporary."
---

# ClawTeam for Kit OpenClaw Gateway

This skill connects the Nexus System OpenClaw gateway to the separate
`The-Nexus-system/ClawTeam-OpenClaw` worker-orchestration repository.

## Contract

- OpenClaw is the persistent primary agent/gateway.
- ClawTeam is an on-demand worker-spawning layer.
- Do not keep worker agents alive when there is no active task for them.
- Workers use isolated git worktrees when modifying repositories.
- Credentials and tokens must never be committed to Git.
- Prefer the OpenClaw backend when spawning workers.

## Health checks

Before spawning a team:

```bash
command -v clawteam
clawteam config health
openclaw status || true
```

If `clawteam` is missing, run the Nexus bootstrap script from the OpenClaw
repository:

```bash
scripts/nexus-kit-gateway-bootstrap.sh
```

## Spawn pattern

Create a team:

```bash
clawteam team spawn-team <team> -d "<goal>" -n leader
```

Create tasks, then spawn workers:

```bash
clawteam task create <team> "<task>" -o <worker>
clawteam spawn -t <team> -n <worker> --task "<task>"
```

For repository work, use worktree isolation:

```bash
clawteam spawn -t <team> -n <worker> --task "<task>" --workspace --repo /path/to/repo
```

Monitor and collect results:

```bash
clawteam board show <team>
clawteam inbox receive <team>
clawteam task list <team>
```

When work is complete, merge only verified worker branches, report the result,
then clean up the team:

```bash
clawteam workspace merge <team> --agent <worker>
clawteam team cleanup <team> --force
```

## Safety

Do not spawn workers for trivial one-step tasks. Do not grant broad shell
permissions just to avoid prompts. Keep the OpenClaw execution policy on an
allowlist and allow only the commands required for the current capability.
