# Kit recovery procedure

Goal: recover the Kit OpenClaw environment after loss of a host, provider, or model backend without rebuilding from scratch.

1. Restore OpenClaw source and bootstrap scripts from GitHub.
2. Restore the private Kit workspace from private or encrypted backup.
3. Restore credentials separately into protected host storage. Restore native OpenClaw SecretRefs/providers and the private Nexus connector vault at `~/.openclaw/kit/connector-secrets.json` from encrypted/private backup; never restore either from public Git.
4. Configure an available model backend.
5. Start OpenClaw and verify gateway health.
6. Verify memory retrieval against known continuity records.
7. Verify required tools one at a time. Run the independent connector probes after credential restore; a recovered credential file alone is not proof that a provider connection still works.
8. Resume from the latest verified handoff rather than reconstructing from conversational memory.

Hosted model weights are not stored here. If a backend changes, rerun capability and behavior transfer tests and document material differences.

Recovery is complete only when the runtime can retrieve continuity, apply the operating loop, use required tools, verify actions, and resume a known handoff.


## Contact channels

After the runtime and external connectors recover, restore the private contact paths.

Telegram:
- restore the bot token through OpenClaw SecretRef;
- restore private allowlisted owner user IDs;
- verify channel status and Telegram capabilities;
- complete a real inbound/outbound DM round-trip.

WhatsApp:
- restore or relink the private Baileys session;
- restore private allowlisted Nexus phone numbers;
- verify the gateway listener is live;
- complete a real inbound/outbound WhatsApp round-trip.

Recovery is not considered complete if Kit can run tools but cannot reach the authorized Nexus contact channels.
