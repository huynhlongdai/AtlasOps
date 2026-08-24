import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine } from "../src/policy.js";
test("policy is fail-closed for non-read operations", () => { const p = new PolicyEngine(); assert.equal(p.decide("read"), "allow"); assert.equal(p.decide("write"), "approval_required"); assert.equal(p.decide("dangerous"), "deny"); });
