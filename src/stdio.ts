import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAtlasApp } from "./app.js";
const app = await createAtlasApp();
void serveStdio(app.createMcpServer);
console.error("AtlasOps MCP stdio server ready");
