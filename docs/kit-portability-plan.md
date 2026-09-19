# Kit portability plan

The goal is to keep the Nexus Kit environment portable across hosts and model providers.

## Portable layers

1. OpenClaw source and gateway configuration.
2. Skills and tool integrations.
3. ClawTeam worker orchestration.
4. A private OpenClaw workspace containing user-approved identity, preferences, memory, and handoff records.
5. Provider-independent model routing so a managed model can be replaced by a self-hosted or alternate provider when needed.
6. Backups of the private workspace and runtime configuration, stored separately from public source code.

## Model boundary

Hosted model weights are not part of the OpenClaw repository and cannot be exported from a hosted ChatGPT session.

OpenAI separately publishes gpt-oss open-weight models. Those can be self-hosted as an optional fallback, but they are different models rather than copies of hosted GPT models.

## Privacy boundary

Public Git must not contain private user memory, credentials, session transcripts, or personal profile information. Those belong on the runtime host and in private or encrypted backups.

## Recovery target

A replacement host should be able to clone the public source, restore the private workspace and secrets, select an available model backend, verify tools, and resume from the latest durable handoff without rebuilding the system from scratch.
