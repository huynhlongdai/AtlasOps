import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { requireAllowedPath, requireSafeEntity, boundedInt, shellQuote } from "./security.js";
import { SshExecutor } from "./ssh.js";
import { ToolRuntime } from "./runtime.js";
import type { ToolResult } from "./types.js";

function asMcpResult(result: ToolResult<unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], ...(result.ok ? {} : { isError: true }) };
}

export function registerAtlasTools(server: McpServer, runtime: ToolRuntime, ssh: SshExecutor): void {
  server.registerTool("list_servers", { description: "List AtlasOps server ids, names, environments and tags. Never returns SSH credentials.", inputSchema: z.object({}) }, async () => asMcpResult(await runtime.run("list_servers", "read", undefined, async () => runtime.inventory.list().map(({ id, displayName, environment, tags }) => ({ id, displayName, environment, tags })) )));

  server.registerTool("server_info", { description: "Inspect OS, uptime, memory and disk usage for one configured server.", inputSchema: z.object({ serverId: z.string().min(1) }) }, async ({ serverId }) => asMcpResult(await runtime.run("server_info", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId);
    return ssh.execFixed(target, "printf '%s\\n' '---hostname---'; hostname; printf '%s\\n' '---kernel---'; uname -srm; printf '%s\\n' '---uptime---'; uptime; printf '%s\\n' '---memory---'; free -h; printf '%s\\n' '---disk---'; df -hP");
  })));

  server.registerTool("docker_ps", { description: "List Docker containers on a configured server. Read-only.", inputSchema: z.object({ serverId: z.string().min(1), all: z.boolean().default(true) }) }, async ({ serverId, all }) => asMcpResult(await runtime.run("docker_ps", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId);
    return ssh.execFixed(target, `docker ps ${all ? "-a " : ""}--no-trunc --format '{{json .}}'`);
  })));

  server.registerTool("docker_logs", { description: "Read recent Docker container logs. No arbitrary shell is accepted.", inputSchema: z.object({ serverId: z.string().min(1), container: z.string().min(1), tail: z.number().int().default(200) }) }, async ({ serverId, container, tail }) => asMcpResult(await runtime.run("docker_logs", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId); const safeContainer = requireSafeEntity(container, "container"); const safeTail = boundedInt(tail, 1, 1000, "tail");
    return ssh.execFixed(target, `docker logs --tail ${safeTail} --timestamps ${safeContainer}`);
  })));

  server.registerTool("service_status", { description: "Read systemd status for a named service without changing it.", inputSchema: z.object({ serverId: z.string().min(1), service: z.string().min(1) }) }, async ({ serverId, service }) => asMcpResult(await runtime.run("service_status", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId); const safeService = requireSafeEntity(service, "service");
    return ssh.execFixed(target, `systemctl --no-pager --full status ${safeService}`);
  })));

  server.registerTool("read_file", { description: "Read a text file only when its resolved path stays in an administrator allowlist.", inputSchema: z.object({ serverId: z.string().min(1), path: z.string().min(1), maxBytes: z.number().int().default(100000) }) }, async ({ serverId, path, maxBytes }) => asMcpResult(await runtime.run("read_file", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId); const limit = boundedInt(maxBytes, 1, 200000, "maxBytes");
    const initiallyAllowed = requireAllowedPath(path, target.allowedReadPaths); const resolved = await ssh.realpath(target, initiallyAllowed); const allowedResolved = requireAllowedPath(resolved, target.allowedReadPaths);
    return { path: allowedResolved, content: await ssh.readFile(target, allowedResolved, limit) };
  })));

  server.registerTool("git_status", { description: "Read git status for a repository inside an allowed read path.", inputSchema: z.object({ serverId: z.string().min(1), repoPath: z.string().min(1) }) }, async ({ serverId, repoPath }) => asMcpResult(await runtime.run("git_status", "read", serverId, async () => {
    const target = runtime.inventory.require(serverId); const initiallyAllowed = requireAllowedPath(repoPath, target.allowedReadPaths); const resolved = await ssh.realpath(target, initiallyAllowed); const allowedResolved = requireAllowedPath(resolved, target.allowedReadPaths);
    return ssh.execFixed(target, `git -C ${shellQuote(allowedResolved)} status --short --branch`);
  })));
}
