import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { AtlasOpsError } from "./config.js";

const SAFE_ENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
export function requireSafeEntity(value: string, field: string): string {
  if (!SAFE_ENTITY.test(value)) throw new AtlasOpsError("INVALID_ARGUMENT", `${field} contains unsupported characters`);
  return value;
}
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new AtlasOpsError("INVALID_ARGUMENT", "NUL byte is not allowed");
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
export function isPathInsideRoots(target: string, roots: string[]): boolean {
  if (!path.posix.isAbsolute(target)) return false;
  const normalized = path.posix.normalize(target);
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}
export function requireAllowedPath(target: string, roots: string[]): string {
  if (!isPathInsideRoots(target, roots)) throw new AtlasOpsError("PATH_DENIED", "Path is outside this server's configured read roots");
  return path.posix.normalize(target);
}
export function boundedInt(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new AtlasOpsError("INVALID_ARGUMENT", `${field} must be an integer between ${min} and ${max}`);
  return value;
}
export function secureTokenEquals(received: string, expected: string): boolean {
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
