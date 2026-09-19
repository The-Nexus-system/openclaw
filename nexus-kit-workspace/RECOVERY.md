# Kit recovery procedure

Goal: recover the Kit OpenClaw environment after loss of a host, provider, or model backend without rebuilding from scratch.

1. Restore OpenClaw source and bootstrap scripts from GitHub.
2. Restore the private Kit workspace from private or encrypted backup.
3. Restore credentials separately into protected host storage.
4. Configure an available model backend.
5. Start OpenClaw and verify gateway health.
6. Verify memory retrieval against known continuity records.
7. Verify required tools one at a time.
8. Resume from the latest verified handoff rather than reconstructing from conversational memory.

Hosted model weights are not stored here. If a backend changes, rerun capability and behavior transfer tests and document material differences.

Recovery is complete only when the runtime can retrieve continuity, apply the operating loop, use required tools, verify actions, and resume a known handoff.
