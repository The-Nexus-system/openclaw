import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerCreativeTools } from "./creative-tools.js";
import { registerGeneralTools } from "./general-tools.js";
import { registerGoogleTools } from "./google-tools.js";
import { registerMicrosoftTools } from "./microsoft-tools.js";
import { registerStatusTools } from "./status-tools.js";
export default definePluginEntry({
  id: "nexus-connectors",
  name: "Nexus Connectors",
  description:
    "Portable connector readiness and independent provider access for the Nexus Kit gateway.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      registryPath: {
        type: "string",
      },
    },
  },
  register(api) {
    registerStatusTools(api);
    registerGeneralTools(api);
    registerCreativeTools(api);
    registerMicrosoftTools(api);
    registerGoogleTools(api);
  },
});
