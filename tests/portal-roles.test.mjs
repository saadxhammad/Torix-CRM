/**
 * Role home paths + Staff portal gating helpers.
 * Run: node --experimental-vm-modules --test tests/portal-roles.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { homePathForRole, isEmployeePortalRole, parseSessionPayload } from "../lib/session-shared";

test("Staff is employee portal role", () => {
  assert.equal(isEmployeePortalRole("Staff"), true);
  assert.equal(isEmployeePortalRole("HR"), false);
  assert.equal(isEmployeePortalRole("Owner"), false);
  assert.equal(isEmployeePortalRole("Department head"), false);
});

test("home paths by role", () => {
  assert.equal(homePathForRole("Staff"), "/portal");
  assert.equal(homePathForRole("HR"), "/");
  assert.equal(homePathForRole("Owner"), "/");
  assert.equal(homePathForRole("Finance"), "/");
});

test("session payload keeps missing role empty (force re-login)", () => {
  const u = parseSessionPayload({ userId: "1", email: "a@b.com" });
  assert.equal(u.role, "");
  const o = parseSessionPayload({ userId: "1", email: "o@b.com", role: "Owner", displayName: "O" });
  assert.equal(o.role, "Owner");
  assert.equal(isEmployeePortalRole(""), false);
  assert.equal(homePathForRole(""), "/");
});
