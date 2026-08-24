import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { requireAllowedPath, requireSafeEntity, boundedInt, shellQuote } from "./security.js";
import { SshExecutor } from "./ssh.js";
import { ToolRuntime } from "./runtime.js";
import type { ToolResult } from "./types.js";
import { AtlasOpsError } from "./config.js";

function asMcpResult(result: ToolResult<unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], ...(result.ok ? {} : { isError: true }) };
}
function requireSuccess(exitCode: number, stderr: string, code: string): void {
  if (exitCode !== 0) throw new AtlasOpsError(code, stderr.trim() || `Remote command exited with ${exitCode}`);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
const approvalIdSchema = z.string().uuid().optional();

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

  server.registerTool("restart_container", { description: "Restart one Docker container and verify it is running. Write action; normally requires operator approval.", inputSchema: z.object({ serverId: z.string().min(1), container: z.string().min(1), approvalId: approvalIdSchema }) }, async ({ serverId, container, approvalId }) => {
    const safeContainer = requireSafeEntity(container, "container"); const approvalArgs = { container: safeContainer };
    return asMcpResult(await runtime.runWrite("restart_container", serverId, approvalArgs, approvalId, async () => {
      const target = runtime.inventory.require(serverId); const restart = await ssh.execFixed(target, `docker restart ${safeContainer}`); requireSuccess(restart.exitCode, restart.stderr, "DOCKER_RESTART_FAILED");
      const verify = await ssh.execFixed(target, `docker inspect --format '{{.State.Running}}' ${safeContainer}`); requireSuccess(verify.exitCode, verify.stderr, "DOCKER_VERIFY_FAILED");
      if (verify.stdout.trim() !== "true") throw new AtlasOpsError("DOCKER_VERIFY_FAILED", "Container is not running after restart");
      return { container: safeContainer, running: true };
    }));
  });

  server.registerTool("restart_service", { description: "Restart one systemd service and verify it is active. Write action; normally requires operator approval.", inputSchema: z.object({ serverId: z.string().min(1), service: z.string().min(1), approvalId: approvalIdSchema }) }, async ({ serverId, service, approvalId }) => {
    const safeService = requireSafeEntity(service, "service"); const approvalArgs = { service: safeService };
    return asMcpResult(await runtime.runWrite("restart_service", serverId, approvalArgs, approvalId, async () => {
      const target = runtime.inventory.require(serverId); const restart = await ssh.execFixed(target, `systemctl restart ${safeService}`); requireSuccess(restart.exitCode, restart.stderr, "SERVICE_RESTART_FAILED");
      const verify = await ssh.execFixed(target, `systemctl is-active ${safeService}`); requireSuccess(verify.exitCode, verify.stderr, "SERVICE_VERIFY_FAILED");
      if (verify.stdout.trim() !== "active") throw new AtlasOpsError("SERVICE_VERIFY_FAILED", "Service is not active after restart");
      return { service: safeService, active: true };
    }));
  });

  server.registerTool("write_file", { description: "Replace an existing text file inside an allowed write root. Creates a backup before atomic replacement and verifies the resulting SHA-256. Write action; normally requires operator approval.", inputSchema: z.object({ serverId: z.string().min(1), path: z.string().min(1), content: z.string().max(1_000_000), approvalId: approvalIdSchema }) }, async ({ serverId, path, content, approvalId }) => {
    const target = runtime.inventory.require(serverId); const requested = requireAllowedPath(path, target.allowedWritePaths); const resolved = await ssh.realpath(target, requested); const allowedResolved = requireAllowedPath(resolved, target.allowedWritePaths);
    const contentSha256 = sha256(content); const approvalArgs = { path: allowedResolved, contentSha256, bytes: Buffer.byteLength(content, "utf8") };
    return asMcpResult(await runtime.runWrite("write_file", serverId, approvalArgs, approvalId, async () => {
      const written = await ssh.writeTextFileWithBackup(target, allowedResolved, content);
      const current = await ssh.readFile(target, allowedResolved, 1_000_000);
      if (sha256(current) !== contentSha256) throw new AtlasOpsError("FILE_VERIFY_FAILED", "Written file hash does not match requested content");
      return { ...written, sha256: contentSha256, verified: true };
    }));
  });

  server.registerTool("compose_pull", { description: "Pull images for an existing Docker Compose file inside an allowed write root. Write action; normally requires operator approval.", inputSchema: z.object({ serverId: z.string().min(1), composeFile: z.string().min(1), approvalId: approvalIdSchema }) }, async ({ serverId, composeFile, approvalId }) => {
    const target = runtime.inventory.require(serverId); const requested = requireAllowedPath(composeFile, target.allowedWritePaths); const resolved = await ssh.realpath(target, requested); const safeFile = requireAllowedPath(resolved, target.allowedWritePaths); const approvalArgs = { composeFile: safeFile };
    return asMcpResult(await runtime.runWrite("compose_pull", serverId, approvalArgs, approvalId, async () => {
      const result = await ssh.execFixed(target, `docker compose -f ${shellQuote(safeFile)} pull`); requireSuccess(result.exitCode, result.stderr, "COMPOSE_PULL_FAILED"); return result;
    }));
  });

  server.registerTool("compose_up", { description: "Run Docker Compose up -d for an existing compose file and verify Compose can enumerate services afterwards. Write action; normally requires operator approval.", inputSchema: z.object({ serverId: z.string().min(1), composeFile: z.string().min(1), approvalId: approvalIdSchema }) }, async ({ serverId, composeFile, approvalId }) => {
    const target = runtime.inventory.require(serverId); const requested = requireAllowedPath(composeFile, target.allowedWritePaths); const resolved = await ssh.realpath(target, requested); const safeFile = requireAllowedPath(resolved, target.allowedWritePaths); const approvalArgs = { composeFile: safeFile };
    return asMcpResult(await runtime.runWrite("compose_up", serverId, approvalArgs, approvalId, async () => {
      const result = await ssh.execFixed(target, `docker compose -f ${shellQuote(safeFile)} up -d`); requireSuccess(result.exitCode, result.stderr, "COMPOSE_UP_FAILED");
      const verify = await ssh.execFixed(target, `docker compose -f ${shellQuote(safeFile)} ps --format json`); requireSuccess(verify.exitCode, verify.stderr, "COMPOSE_VERIFY_FAILED");
      return { output: result.stdout, services: verify.stdout, verified: true };
    }));
  });
}
