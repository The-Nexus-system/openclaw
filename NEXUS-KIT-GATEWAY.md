# Kit OpenClaw Gateway

This repository is the Nexus System's persistent **Kit OpenClaw Gateway**.

It is not a second ClawTeam repository and it is not the worker swarm itself.

The two GitHub projects have separate roles:

- `The-Nexus-system/openclaw`: persistent Kit/OpenClaw gateway and primary agent runtime.
- `The-Nexus-system/ClawTeam-OpenClaw`: on-demand worker-agent spawning and coordination layer.

The integration point is the `clawteam` OpenClaw skill plus
`scripts/nexus-kit-gateway-bootstrap.sh`.

Running the bootstrap on the machine that hosts OpenClaw installs the Nexus
ClawTeam fork, exposes its OpenClaw skill, and leaves workers dormant until Kit
explicitly needs parallel agents.

GitHub stores the source and integration configuration. GitHub by itself does
not keep the gateway process running continuously; an actual host is still
required for an always-on gateway.

Secrets, Apple app-specific passwords, API tokens, and mailbox credentials must
be stored on the runtime host or its secret manager and must never be committed
to this repository.
