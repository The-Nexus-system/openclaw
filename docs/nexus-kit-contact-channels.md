# Nexus Kit contact channels

Telegram and WhatsApp are priority-one contact paths for the persistent Kit runtime.

The goal is not merely to configure accounts. Recovery is complete only when Kit can receive from and send to an explicitly authorized Nexus contact.

## Telegram

Use the native OpenClaw Telegram channel.

Recommended policy:

- dedicated bot created through BotFather;
- bot token stored through OpenClaw native SecretRef support;
- `dmPolicy: "allowlist"`;
- explicit numeric Nexus owner/user IDs in `allowFrom`;
- group access disabled or allowlisted unless intentionally configured;
- do not use `open` DM access for the private Kit contact bot.

Telegram setup does not require storing a Telegram account password.

Verification sequence:

1. `openclaw channels status`
2. `openclaw channels capabilities --channel telegram`
3. send a DM from an allowlisted Nexus account to the bot and confirm OpenClaw receives it;
4. send a harmless reply from Kit and confirm it arrives in Telegram.

Only after both directions work is Telegram contact delivery considered verified.

## WhatsApp

Use the native OpenClaw WhatsApp Web channel backed by Baileys.

Recommended policy:

- use a dedicated WhatsApp number for Kit if practical;
- personal-number/self-chat mode remains supported when needed;
- `dmPolicy: "allowlist"`;
- explicit Nexus E.164 phone numbers in `allowFrom`;
- groups remain allowlisted unless deliberately enabled.

Initial link:

`openclaw channels login --channel whatsapp`

This is a QR/session pairing flow rather than an API password.

WhatsApp linked-session credentials are runtime/session material. OpenClaw intentionally does not treat them as ordinary SecretRef credentials. They must be included in the private encrypted runtime backup and never committed to Git.

Verification sequence:

1. confirm the WhatsApp plugin is installed;
2. confirm `openclaw channels status` shows the account linked and live;
3. run `openclaw status --deep`;
4. send a harmless inbound WhatsApp message from an allowlisted Nexus number and confirm OpenClaw receives it;
5. send a harmless Kit reply and confirm delivery.

A copied/stored WhatsApp session is not considered healthy until the live listener reconnects and an actual message round-trip succeeds.

## Failover

Keep Telegram and WhatsApp independent enough that one provider outage does not remove every direct contact path.

The preferred contact order can be configured later, but provider failure must not cause automatic broadcasting to every channel. Kit should send through one intended channel and fail over deliberately when delivery fails.

## Privacy

Do not put personal phone numbers, Telegram user IDs, bot tokens, WhatsApp session files, or message history in the public OpenClaw repository.

Public Git may contain only templates and setup rules. Real identifiers and credentials belong in private runtime configuration/backups.
