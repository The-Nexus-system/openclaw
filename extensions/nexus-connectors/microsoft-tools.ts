import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  normalizeApiPath,
  providerGet,
  providerJsonRequest,
  sleep,
  safeHeaderValue,
  getMicrosoftAccessToken,
} from "./shared.js";

export function registerMicrosoftTools(api: OpenClawPluginApi) {
      name: "nexus_microsoft_graph_get",
      description:
        "Perform an independently authenticated read-only GET against Microsoft Graph using OAuth credentials stored on the OpenClaw host. This is for Outlook mail/calendar and related Microsoft Graph reads and does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "Microsoft Graph v1.0 provider-relative path such as /me, /me/messages?$top=10, or /me/calendars.",
        }),
      }),
      async execute(_id, params) {
        try {
          const token = await getMicrosoftAccessToken();
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://graph.microsoft.com/v1.0${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool(
      {
        name: "nexus_outlook_send_mail",
        description:
          "Send a plain-text email through Microsoft Graph using independent OpenClaw OAuth credentials, then verify that the message appears in Sent Items. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          to: Type.String(),
          subject: Type.String(),
          body: Type.String(),
        }),
        async execute(_id, params) {
          try {
            const to = safeHeaderValue(params.to, "to");
            const subject = safeHeaderValue(params.subject, "subject");
            if (!to) throw new Error("to is required");

            const token = await getMicrosoftAccessToken([
              "Mail.Read",
              "Mail.Send",
            ]);
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            const send = await providerJsonRequest(
              "https://graph.microsoft.com/v1.0/me/sendMail",
              "POST",
              headers,
              {
                message: {
                  subject,
                  body: {
                    contentType: "Text",
                    content: params.body,
                  },
                  toRecipients: [
                    {
                      emailAddress: {
                        address: to,
                      },
                    },
                  ],
                },
                saveToSentItems: true,
              },
            );

            if (!send.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        stage: "send",
                        status: send.status,
                        body: send.body,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }

            let verified = false;
            let verificationStatus: number | null = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
              await sleep(700);
              const sent = await providerGet(
                "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=10&$select=id,subject,toRecipients,sentDateTime&$orderby=sentDateTime%20desc",
                headers,
              );
              verificationStatus = sent.status;
              if (sent.ok && sent.body && typeof sent.body === "object" && "value" in sent.body) {
                const value = (sent.body as { value?: Array<{ subject?: string; toRecipients?: Array<{ emailAddress?: { address?: string } }> }> }).value ?? [];
                verified = value.some(
                  (message) =>
                    message.subject === subject &&
                    (message.toRecipients ?? []).some(
                      (recipient) =>
                        recipient.emailAddress?.address?.toLowerCase() === to.toLowerCase(),
                    ),
                );
                if (verified) break;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: verified,
                      sentAccepted: true,
                      postconditionVerified: verified,
                      verificationStatus,
                      warning: verified
                        ? undefined
                        : "Graph accepted the send, but the Sent Items readback did not confirm it yet.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );

    api.registerTool(
      {
        name: "nexus_outlook_create_event",
        description:
          "Create an Outlook calendar event through Microsoft Graph using independent OpenClaw OAuth credentials, then read the event back by id to verify persistence. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          subject: Type.String(),
          start: Type.String({
            description: "Local date-time string accepted by Microsoft Graph, for example 2026-09-20T14:00:00.",
          }),
          end: Type.String({
            description: "Local date-time string accepted by Microsoft Graph.",
          }),
          timeZone: Type.String({
            description: "Microsoft Graph time-zone label, for example Eastern Standard Time.",
          }),
          body: Type.Optional(Type.String()),
        }),
        async execute(_id, params) {
          try {
            const subject = safeHeaderValue(params.subject, "subject");
            if (!subject) throw new Error("subject is required");

            const token = await getMicrosoftAccessToken([
              "Calendars.ReadWrite",
            ]);
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            const created = await providerJsonRequest(
              "https://graph.microsoft.com/v1.0/me/events",
              "POST",
              headers,
              {
                subject,
                body: {
                  contentType: "Text",
                  content: params.body ?? "",
                },
                start: {
                  dateTime: params.start,
                  timeZone: params.timeZone,
                },
                end: {
                  dateTime: params.end,
                  timeZone: params.timeZone,
                },
              },
            );

            const eventId =
              created.ok &&
              created.body &&
              typeof created.body === "object" &&
              "id" in created.body &&
              typeof (created.body as { id?: unknown }).id === "string"
                ? (created.body as { id: string }).id
                : null;

            if (!created.ok || !eventId) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        stage: "create",
                        status: created.status,
                        body: created.body,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }

            const verify = await providerGet(
              `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}?$select=id,subject,start,end`,
              headers,
            );

            const persisted =
              verify.ok &&
              verify.body &&
              typeof verify.body === "object" &&
              "id" in verify.body &&
              (verify.body as { id?: unknown }).id === eventId;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: Boolean(persisted),
                      eventId,
                      postconditionVerified: Boolean(persisted),
                      verificationStatus: verify.status,
                      body: verify.body,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );

    api.registerTool({
}
