import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  normalizeApiPath,
  providerGet,
  providerJsonRequest,
  dropboxApi,
  notionHeaders,
  linearGraphql,
  getZoomAccessToken,
  zoomTargetUser,
} from "./shared.js";

export function registerGeneralTools(api: OpenClawPluginApi) {
      name: "nexus_github_get",
      description:
        "Perform an independently authenticated read-only GET against the GitHub REST API using GITHUB_TOKEN on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "GitHub REST API path such as /repos/OWNER/REPO or /user/repos?per_page=20.",
        }),
      }),
      async execute(_id, params) {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: "GITHUB_TOKEN is not configured on the OpenClaw host.",
                }),
              },
            ],
          };
        }

        try {
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://api.github.com${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
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

    api.registerTool({
      name: "nexus_digitalocean_get",
      description:
        "Perform an independently authenticated read-only GET against the DigitalOcean v2 API using DIGITALOCEAN_ACCESS_TOKEN on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description: "DigitalOcean v2 path such as /account, /droplets, or /regions.",
        }),
      }),
      async execute(_id, params) {
        const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
        if (!token) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: "DIGITALOCEAN_ACCESS_TOKEN is not configured on the OpenClaw host.",
                }),
              },
            ],
          };
        }

        try {
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://api.digitalocean.com/v2${apiPath}`, {
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


    api.registerTool({
      name: "nexus_zoom_read",
      description:
        "Read Zoom through an independently authenticated OpenClaw route. Supports user details, meeting lists, and cloud recordings without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("user"),
          Type.Literal("meetings"),
          Type.Literal("recordings"),
        ]),
        userId: Type.Optional(Type.String()),
        pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        from: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD start date for recordings." })),
        to: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD end date for recordings." })),
      }),
      async execute(_id, params) {
        try {
          const auth = await getZoomAccessToken();
          const userId = zoomTargetUser(auth.mode, params.userId);
          const headers = {
            Authorization: `Bearer ${auth.token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          };

          let url: string;
          if (params.operation === "user") {
            url = `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}`;
          } else if (params.operation === "meetings") {
            url =
              `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings` +
              `?type=previous_meetings&page_size=${params.pageSize ?? 20}`;
          } else {
            const query = new URLSearchParams({
              page_size: String(params.pageSize ?? 20),
            });
            if (params.from?.trim()) query.set("from", params.from.trim());
            if (params.to?.trim()) query.set("to", params.to.trim());
            url =
              `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/recordings?` +
              query.toString();
          }

          const result = await providerGet(url, headers);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_linear_read",
      description:
        "Read Linear through an independently authenticated OpenClaw route. Supports viewer identity, issues, teams, and projects without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("issues"),
          Type.Literal("teams"),
          Type.Literal("projects"),
        ]),
        first: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(_id, params) {
        try {
          const first = params.first ?? 20;
          let query: string;
          let variables: Record<string, unknown> = {};

          if (params.operation === "me") {
            query = "query NexusKitViewer { viewer { id name email displayName } }";
          } else if (params.operation === "issues") {
            query = `
              query NexusKitIssues($first: Int!) {
                issues(first: $first) {
                  nodes {
                    id
                    identifier
                    title
                    url
                    updatedAt
                    state { id name type }
                    team { id name key }
                    assignee { id name email }
                  }
                }
              }
            `;
            variables = { first };
          } else if (params.operation === "teams") {
            query = `
              query NexusKitTeams($first: Int!) {
                teams(first: $first) {
                  nodes { id name key description }
                }
              }
            `;
            variables = { first };
          } else {
            query = `
              query NexusKitProjects($first: Int!) {
                projects(first: $first) {
                  nodes { id name slugId url state progress updatedAt }
                }
              }
            `;
            variables = { first };
          }

          const result = await linearGraphql(query, variables);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_notion_read",
      description:
        "Read Notion through an independently authenticated OpenClaw route. Supports token identity, workspace search, and page retrieval without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("search"),
          Type.Literal("page"),
        ]),
        query: Type.Optional(Type.String()),
        pageId: Type.Optional(Type.String()),
        pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(_id, params) {
        try {
          const headers = notionHeaders();

          if (params.operation === "me") {
            const result = await providerGet("https://api.notion.com/v1/users/me", headers);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          if (params.operation === "search") {
            const result = await providerJsonRequest(
              "https://api.notion.com/v1/search",
              "POST",
              headers,
              {
                ...(params.query?.trim() ? { query: params.query.trim() } : {}),
                page_size: params.pageSize ?? 20,
                sort: {
                  direction: "descending",
                  timestamp: "last_edited_time",
                },
              },
            );
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          const pageId = params.pageId?.trim();
          if (!pageId) throw new Error("pageId is required for Notion page retrieval");
          const result = await providerGet(
            `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
            headers,
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_dropbox_read",
      description:
        "Read Dropbox through an independently authenticated OpenClaw route. Operations are limited to account identity, folder listing, search, and metadata; this tool does not mutate Dropbox.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("account"),
          Type.Literal("list_folder"),
          Type.Literal("search"),
          Type.Literal("metadata"),
        ]),
        path: Type.Optional(Type.String()),
        query: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(_id, params) {
        try {
          let result;

          if (params.operation === "account") {
            result = await dropboxApi("users/get_current_account", {});
          } else if (params.operation === "list_folder") {
            result = await dropboxApi("files/list_folder", {
              path: params.path ?? "",
              recursive: false,
              include_deleted: false,
              include_non_downloadable_files: true,
              limit: params.limit ?? 20,
            });
          } else if (params.operation === "search") {
            const query = params.query?.trim();
            if (!query) throw new Error("query is required for Dropbox search");
            result = await dropboxApi("files/search_v2", {
              query,
              options: {
                path: params.path ?? "",
                max_results: params.limit ?? 20,
                file_status: "active",
              },
            });
          } else {
            const targetPath = params.path?.trim();
            if (!targetPath) throw new Error("path is required for Dropbox metadata");
            result = await dropboxApi("files/get_metadata", {
              path: targetPath,
              include_media_info: false,
              include_deleted: false,
              include_has_explicit_shared_members: true,
            });
          }

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
}
