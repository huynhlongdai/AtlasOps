import assert from "node:assert/strict";
import test from "node:test";
import { boundedInt, isPathInsideRoots, requireSafeEntity, shellQuote, secureTokenEquals } from "../src/security.js";

test("path allowlist blocks traversal and sibling prefixes", () => {
  const roots = ["/opt/apps", "/var/log"];
  assert.equal(isPathInsideRoots("/opt/apps/a/config.yml", roots), true);
  assert.equal(isPathInsideRoots("/opt/apps2/secret", roots), false);
  assert.equal(isPathInsideRoots("/opt/apps/../secrets/x", roots), false);
  assert.equal(isPathInsideRoots("/etc/passwd", roots), false);
});
test("entity validation rejects shell syntax", () => {
  assert.equal(requireSafeEntity("api-1.service", "service"), "api-1.service");
  assert.throws(() => requireSafeEntity("api;rm", "service"));
  assert.throws(() => requireSafeEntity("$(id)", "service"));
  assert.throws(() => requireSafeEntity("foo bar", "service"));
});
test("shellQuote treats single quote as data", () => assert.equal(shellQuote("a'b"), "'a'\"'\"'b'"));
test("boundedInt enforces limits", () => { assert.equal(boundedInt(200, 1, 1000, "tail"), 200); assert.throws(() => boundedInt(1001, 1, 1000, "tail")); assert.throws(() => boundedInt(1.5, 1, 1000, "tail")); });
test("constant time token helper requires exact equality", () => { assert.equal(secureTokenEquals("abcdef", "abcdef"), true); assert.equal(secureTokenEquals("abcdef", "abcdeg"), false); assert.equal(secureTokenEquals("short", "much-longer"), false); });
