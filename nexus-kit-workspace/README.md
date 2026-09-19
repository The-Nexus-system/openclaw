# Nexus Kit workspace template

This directory is a portable, model-independent scaffold for the Nexus System's Kit agent.

It is meant to preserve the parts of Kit that can be kept outside any single model provider: identity, communication style, operating method, skills, continuity conventions, and model-provider failover behavior.

The hosted GPT-5.6 Sol model itself is not exportable from this runtime. Its weights are not available here. OpenAI's separately published gpt-oss models can be self-hosted, but they are different models and should be treated as fallback reasoning engines rather than copies of GPT-5.6 Sol.

This repository may be public, so do not store personal user history, private memories, credentials, raw chats, or secrets here. Those belong in the private OpenClaw workspace on the runtime host and should only be backed up to private or encrypted storage.

The standard OpenClaw workspace files used by this template are AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, and HEARTBEAT.md. Private USER.md and MEMORY.md files are intentionally not included here.
