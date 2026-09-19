# Heartbeat

Keep heartbeat work small and useful.

- Check gateway health.
- Check whether a high-value handoff is waiting.
- Check whether temporary workers were left running without an active task.
- Check whether a consequential continuity write still needs verification.
- Record only meaningful durable state changes.
- Do not generate noise when nothing important changed.
