import type { AgentToolDefinition, ProviderToolResult } from "./providers/types.js";
import { AtlasOpsError } from "./config.js";
import { boundedInt, requireAllowedPath, requireSafeEntity, shellQuote } from "./security.js";
import { SshExecutor } from "./ssh.js";
import { ToolRuntime } from "./runtime.js";

interface AgentTool {
  definition: AgentToolDefinition;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  constructor(private readonly runtime: ToolRuntime, private readonly ssh: SshExecutor) { this.registerDefaults(); }

  definitions(): AgentToolDefinition[] { return [...this.tools.values()].map((tool) => tool.definition); }

  async execute(callId: string, name: string, args: Record<string, unknown>): Promise<ProviderToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { callId, name, result: { ok: false, error: { code: "TOOL_NOT_FOUND", message: `Unknown agent tool: ${name}` } } };
    try { return { callId, name, result: await tool.execute(args) }; }
    catch (error) {
      const code = error instanceof AtlasOpsError ? error.code : "TOOL_FAILED";
      return { callId, name, result: { ok: false, error: { code, message: error instanceof Error ? error.message : "Unknown tool error" } } };
    }
  }

  private register(tool: AgentTool): void { this.tools.set(tool.definition.name, tool); }
  private stringArg(args: Record<string, unknown>, name: string): string {
    const value = args[name]; if (typeof value !== "string" || !value) throw new AtlasOpsError("INVALID_ARGUMENT", `${name} must be a non-empty string`); return value;
  }

  private registerDefaults(): void {
    this.register({ definition: { name: "list_servers", description: "List configured AtlasOps server ids, names, environments and tags.", parameters: { type: "object", properties: {}, additionalProperties: false } }, execute: async () => this.runtime.run("agent.list_servers", "read", undefined, async () => this.runtime.inventory.list().map(({ id, displayName, environment, tags }) => ({ id, displayName, environment, tags }))) });

    this.register({ definition: { name: "server_info", description: "Inspect OS, uptime, memory and disk usage for one server.", parameters: { type: "object", properties: { serverId: { type: "string" } }, required: ["serverId"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); return this.runtime.run("agent.server_info", "read", serverId, async () => this.ssh.execFixed(this.runtime.inventory.require(serverId), "printf '%s\\n' '---hostname---'; hostname; printf '%s\\n' '---kernel---'; uname -srm; printf '%s\\n' '---uptime---'; uptime; printf '%s\\n' '---memory---'; free -h; printf '%s\\n' '---disk---'; df -hP"));
    }});

    this.register({ definition: { name: "docker_ps", description: "List Docker containers on a server.", parameters: { type: "object", properties: { serverId: { type: "string" }, all: { type: "boolean" } }, required: ["serverId"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); const all = args.all === undefined ? true : Boolean(args.all); return this.runtime.run("agent.docker_ps", "read", serverId, async () => this.ssh.execFixed(this.runtime.inventory.require(serverId), `docker ps ${all ? "-a " : ""}--no-trunc --format '{{json .}}'`));
    }});

    this.register({ definition: { name: "docker_logs", description: "Read recent Docker logs for a named container.", parameters: { type: "object", properties: { serverId: { type: "string" }, container: { type: "string" }, tail: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["serverId", "container"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); const container = requireSafeEntity(this.stringArg(args, "container"), "container"); const tail = boundedInt(typeof args.tail === "number" ? args.tail : 200, 1, 1000, "tail"); return this.runtime.run("agent.docker_logs", "read", serverId, async () => this.ssh.execFixed(this.runtime.inventory.require(serverId), `docker logs --tail ${tail} --timestamps ${container}`));
    }});

    this.register({ definition: { name: "service_status", description: "Read systemd status for a service.", parameters: { type: "object", properties: { serverId: { type: "string" }, service: { type: "string" } }, required: ["serverId", "service"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); const service = requireSafeEntity(this.stringArg(args, "service"), "service"); return this.runtime.run("agent.service_status", "read", serverId, async () => this.ssh.execFixed(this.runtime.inventory.require(serverId), `systemctl --no-pager --full status ${service}`));
    }});

    this.register({ definition: { name: "read_file", description: "Read a text file only inside the server read allowlist.", parameters: { type: "object", properties: { serverId: { type: "string" }, path: { type: "string" }, maxBytes: { type: "integer", minimum: 1, maximum: 200000 } }, required: ["serverId", "path"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); const target = this.runtime.inventory.require(serverId); const limit = boundedInt(typeof args.maxBytes === "number" ? args.maxBytes : 100000, 1, 200000, "maxBytes"); return this.runtime.run("agent.read_file", "read", serverId, async () => { const initial = requireAllowedPath(this.stringArg(args, "path"), target.allowedReadPaths); const resolved = requireAllowedPath(await this.ssh.realpath(target, initial), target.allowedReadPaths); return { path: resolved, content: await this.ssh.readFile(target, resolved, limit) }; });
    }});

    this.register({ definition: { name: "git_status", description: "Read git status for a repository inside the server read allowlist.", parameters: { type: "object", properties: { serverId: { type: "string" }, repoPath: { type: "string" } }, required: ["serverId", "repoPath"], additionalProperties: false } }, execute: async (args) => {
      const serverId = this.stringArg(args, "serverId"); const target = this.runtime.inventory.require(serverId); return this.runtime.run("agent.git_status", "read", serverId, async () => { const initial = requireAllowedPath(this.stringArg(args, "repoPath"), target.allowedReadPaths); const resolved = requireAllowedPath(await this.ssh.realpath(target, initial), target.allowedReadPaths); return this.ssh.execFixed(target, `git -C ${shellQuote(resolved)} status --short --branch`); });
    }});
  }
}
