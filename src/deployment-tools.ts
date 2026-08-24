import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { AtlasOpsError } from "./config.js";
import { DeploymentStore } from "./deployment.js";
import { ToolRuntime } from "./runtime.js";
import { requireAllowedPath, shellQuote } from "./security.js";
import { SshExecutor } from "./ssh.js";
import type { ServerDefinition, ToolResult } from "./types.js";

function asMcpResult(result: ToolResult<unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], ...(result.ok ? {} : { isError: true }) };
}
function requireSuccess(exitCode: number, stderr: string, code: string): void {
  if (exitCode !== 0) throw new AtlasOpsError(code, stderr.trim() || `Remote command exited with ${exitCode}`);
}
function normalizeHealthUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new AtlasOpsError('INVALID_HEALTH_URL', 'Health URL must use http or https');
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) throw new AtlasOpsError('INVALID_HEALTH_URL', 'Health URL must target loopback on the managed server');
  if (url.username || url.password) throw new AtlasOpsError('INVALID_HEALTH_URL', 'Credentials are not allowed in health URLs');
  return url.toString();
}

async function resolveDeploymentPaths(target: ServerDefinition, ssh: SshExecutor, repoPath: string, composeFile: string): Promise<{ repoPath: string; composeFile: string }> {
  const repoRequested = requireAllowedPath(repoPath, target.allowedWritePaths); const repoResolved = requireAllowedPath(await ssh.realpath(target, repoRequested), target.allowedWritePaths);
  const composeRequested = requireAllowedPath(composeFile, target.allowedWritePaths); const composeResolved = requireAllowedPath(await ssh.realpath(target, composeRequested), target.allowedWritePaths);
  if (!(composeResolved === repoResolved || composeResolved.startsWith(`${repoResolved}/`))) throw new AtlasOpsError('PATH_DENIED', 'Compose file must be inside the deployment repository');
  return { repoPath: repoResolved, composeFile: composeResolved };
}

async function preflight(target: ServerDefinition, ssh: SshExecutor, repoPath: string, composeFile: string) {
  const paths = await resolveDeploymentPaths(target, ssh, repoPath, composeFile);
  const status = await ssh.execFixed(target, `git -C ${shellQuote(paths.repoPath)} status --porcelain`); requireSuccess(status.exitCode, status.stderr, 'GIT_STATUS_FAILED');
  if (status.stdout.trim()) throw new AtlasOpsError('REPO_DIRTY', 'Deployment requires a clean git working tree for safe rollback');
  const head = await ssh.execFixed(target, `git -C ${shellQuote(paths.repoPath)} rev-parse HEAD`); requireSuccess(head.exitCode, head.stderr, 'GIT_HEAD_FAILED');
  const beforeHead = head.stdout.trim(); if (!/^[a-f0-9]{40}$/i.test(beforeHead)) throw new AtlasOpsError('GIT_HEAD_FAILED', 'Unexpected git HEAD value');
  const compose = await ssh.execFixed(target, `docker compose -f ${shellQuote(paths.composeFile)} config --quiet`); requireSuccess(compose.exitCode, compose.stderr, 'COMPOSE_CONFIG_FAILED');
  const services = await ssh.execFixed(target, `docker compose -f ${shellQuote(paths.composeFile)} config --services`); requireSuccess(services.exitCode, services.stderr, 'COMPOSE_CONFIG_FAILED');
  return { ...paths, beforeHead, expectedServices: services.stdout.split(/\r?\n/).filter(Boolean) };
}

async function verifyDeployment(target: ServerDefinition, ssh: SshExecutor, composeFile: string, expectedServices: string[], healthUrl?: string): Promise<{ runningServices: string[]; healthChecked: boolean }> {
  const running = await ssh.execFixed(target, `docker compose -f ${shellQuote(composeFile)} ps --status running --services`); requireSuccess(running.exitCode, running.stderr, 'COMPOSE_VERIFY_FAILED');
  const runningServices = running.stdout.split(/\r?\n/).filter(Boolean);
  const missing = expectedServices.filter((service) => !runningServices.includes(service));
  if (missing.length) throw new AtlasOpsError('COMPOSE_VERIFY_FAILED', `Services not running: ${missing.join(', ')}`);
  if (healthUrl) {
    const health = await ssh.execFixed(target, `curl --fail --silent --show-error --max-time 10 ${shellQuote(healthUrl)} >/dev/null`);
    requireSuccess(health.exitCode, health.stderr, 'HEALTH_CHECK_FAILED');
  }
  return { runningServices, healthChecked: Boolean(healthUrl) };
}

export function registerDeploymentTools(server: McpServer, runtime: ToolRuntime, ssh: SshExecutor, deployments: DeploymentStore): void {
  server.registerTool('deployment_preflight', { description: 'Validate a clean git repository and Docker Compose config before deployment. Read-only.', inputSchema: z.object({ serverId: z.string().min(1), repoPath: z.string().min(1), composeFile: z.string().min(1), healthUrl: z.string().optional() }) }, async ({ serverId, repoPath, composeFile, healthUrl }) => asMcpResult(await runtime.run('deployment_preflight', 'read', serverId, async () => {
    const target = runtime.inventory.require(serverId); const normalizedHealthUrl = normalizeHealthUrl(healthUrl); return { ...(await preflight(target, ssh, repoPath, composeFile)), healthUrl: normalizedHealthUrl };
  })));

  server.registerTool('list_deployments', { description: 'List AtlasOps deployment history without credentials or secret material.', inputSchema: z.object({ serverId: z.string().optional() }) }, async ({ serverId }) => asMcpResult(await runtime.run('list_deployments', 'read', serverId, async () => deployments.list(serverId))));

  server.registerTool('deploy_compose', { description: 'Pull the current git branch with --ff-only, run Docker Compose, verify all services, and automatically roll back to the previous commit if verification fails. Approval-gated write action.', inputSchema: z.object({ serverId: z.string().min(1), repoPath: z.string().min(1), composeFile: z.string().min(1), healthUrl: z.string().optional(), approvalId: z.string().uuid().optional() }) }, async ({ serverId, repoPath, composeFile, healthUrl, approvalId }) => {
    const target = runtime.inventory.require(serverId); const normalizedHealthUrl = normalizeHealthUrl(healthUrl); const paths = await resolveDeploymentPaths(target, ssh, repoPath, composeFile);
    const approvalArgs = { repoPath: paths.repoPath, composeFile: paths.composeFile, ...(normalizedHealthUrl ? { healthUrl: normalizedHealthUrl } : {}) };
    return asMcpResult(await runtime.runWrite('deploy_compose', serverId, approvalArgs, approvalId, async () => {
      const before = await preflight(target, ssh, paths.repoPath, paths.composeFile);
      const record = await deployments.create({ serverId, repoPath: paths.repoPath, composeFile: paths.composeFile, beforeHead: before.beforeHead, ...(normalizedHealthUrl ? { healthUrl: normalizedHealthUrl } : {}) });
      try {
        const pull = await ssh.execFixed(target, `git -C ${shellQuote(paths.repoPath)} pull --ff-only`); requireSuccess(pull.exitCode, pull.stderr, 'GIT_PULL_FAILED');
        const after = await ssh.execFixed(target, `git -C ${shellQuote(paths.repoPath)} rev-parse HEAD`); requireSuccess(after.exitCode, after.stderr, 'GIT_HEAD_FAILED'); const afterHead = after.stdout.trim();
        const up = await ssh.execFixed(target, `docker compose -f ${shellQuote(paths.composeFile)} up -d`); requireSuccess(up.exitCode, up.stderr, 'COMPOSE_UP_FAILED');
        const verified = await verifyDeployment(target, ssh, paths.composeFile, before.expectedServices, normalizedHealthUrl);
        await deployments.update(record.id, { status: 'succeeded', finishedAt: new Date().toISOString(), afterHead });
        return { deploymentId: record.id, beforeHead: before.beforeHead, afterHead, ...verified };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Deployment failed';
        try {
          const reset = await ssh.execFixed(target, `git -C ${shellQuote(paths.repoPath)} reset --hard ${shellQuote(before.beforeHead)}`); requireSuccess(reset.exitCode, reset.stderr, 'ROLLBACK_GIT_FAILED');
          const restore = await ssh.execFixed(target, `docker compose -f ${shellQuote(paths.composeFile)} up -d`); requireSuccess(restore.exitCode, restore.stderr, 'ROLLBACK_COMPOSE_FAILED');
          await verifyDeployment(target, ssh, paths.composeFile, before.expectedServices, normalizedHealthUrl);
          await deployments.update(record.id, { status: 'rolled_back', finishedAt: new Date().toISOString(), error: message });
          throw new AtlasOpsError('DEPLOYMENT_ROLLED_BACK', `Deployment failed and was rolled back: ${message}`);
        } catch (rollbackError) {
          if (rollbackError instanceof AtlasOpsError && rollbackError.code === 'DEPLOYMENT_ROLLED_BACK') throw rollbackError;
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'Rollback failed';
          await deployments.update(record.id, { status: 'rollback_failed', finishedAt: new Date().toISOString(), error: message, rollbackError: rollbackMessage });
          throw new AtlasOpsError('ROLLBACK_FAILED', `Deployment failed (${message}); rollback also failed (${rollbackMessage})`);
        }
      }
    }));
  });

  server.registerTool('rollback_deployment', { description: 'Rollback a recorded deployment to its pre-deploy git commit and re-run Docker Compose. Requires a clean repo and operator approval.', inputSchema: z.object({ deploymentId: z.string().uuid(), approvalId: z.string().uuid().optional() }) }, async ({ deploymentId, approvalId }) => {
    const record = await deployments.get(deploymentId);
    if (!record) return asMcpResult({ ok: false, error: { code: 'DEPLOYMENT_NOT_FOUND', message: `Unknown deployment id: ${deploymentId}` } });
    const target = runtime.inventory.require(record.serverId); const approvalArgs = { deploymentId, beforeHead: record.beforeHead };
    return asMcpResult(await runtime.runWrite('rollback_deployment', record.serverId, approvalArgs, approvalId, async () => {
      const before = await preflight(target, ssh, record.repoPath, record.composeFile);
      const reset = await ssh.execFixed(target, `git -C ${shellQuote(record.repoPath)} reset --hard ${shellQuote(record.beforeHead)}`); requireSuccess(reset.exitCode, reset.stderr, 'ROLLBACK_GIT_FAILED');
      const up = await ssh.execFixed(target, `docker compose -f ${shellQuote(record.composeFile)} up -d`); requireSuccess(up.exitCode, up.stderr, 'ROLLBACK_COMPOSE_FAILED');
      const verified = await verifyDeployment(target, ssh, record.composeFile, before.expectedServices, record.healthUrl);
      await deployments.update(record.id, { status: 'rolled_back', finishedAt: new Date().toISOString() });
      return { deploymentId, restoredHead: record.beforeHead, ...verified };
    }));
  });
}
