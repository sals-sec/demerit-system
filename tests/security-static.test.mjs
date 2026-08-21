import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("does not ship plaintext account or personnel seed files", async () => {
  for (const path of [
    new URL("../data/users.json", import.meta.url),
    new URL("../data/staff-records.json", import.meta.url),
    new URL("../data/worker-records.json", import.meta.url),
  ]) {
    await assert.rejects(access(path));
  }
});

test("state reads require an authenticated user", async () => {
  const source = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!user\) return json\(\{ error: "Sign in required\." \}/);
  assert.match(source, /readStateSnapshot\(\)/);
});

test("state writes carry revisions and conflict with stale clients", async () => {
  const server = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  assert.match(server, /status: 409/);
  assert.match(server, /expectedRevision/);
  assert.match(client, /revision: currentRevision/);
});

test("the HTML entry point uses SRI and the worker emits CSP", async () => {
  const html = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const headers = await readFile(new URL("../lib/html-response.mjs", import.meta.url), "utf8");
  assert.match(html, /integrity="sha384-/);
  assert.match(headers, /content-security-policy/);
  assert.match(headers, /'strict-dynamic'/);
});

test("role hierarchy and feedback moderation are enforced by server routes", async () => {
  const users = await readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8");
  const feedback = await readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
  const feedbackStore = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");
  const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");

  assert.match(security, /\["super_admin", "admin", "standard_user"\]/);
  assert.match(users, /role === "super_admin" \? "admin" : role === "admin" \? "standard_user"/);
  assert.match(users, /deleteManagedAccount/);
  assert.match(users, /export async function DELETE/);
  assert.match(security, /account\.role === "admin" \|\| account\.role === "standard_user"/);
  assert.match(security, /DELETE FROM user_sessions WHERE username = \?/);
  assert.match(security, /You do not have permission to delete this account/);
  assert.match(feedback, /user\.role !== "standard_user"/);
  assert.match(feedback, /user\.role !== "super_admin" && user\.role !== "admin"/);
  assert.match(feedback, /Admin or Super Admin access is required/);
  assert.match(feedback, /appeal_accepted/);
  assert.match(feedback, /body\.status !== "rejected"/);
  assert.match(feedbackStore, /An appeal must be accepted or rejected/);
  assert.match(feedbackStore, /Only an appeal can be rejected/);
  assert.match(feedback, /The selected personnel record no longer exists/);
  assert.match(feedback, /Personnel responses must be a comment or an appeal/);
  assert.match(feedback, /subjectPersonId/);
  assert.match(feedback, /subjectGroup/);
});

test("Dashboard reset is restricted to Super Admin and preserves master groups", async () => {
  const reset = await readFile(new URL("../app/api/reset/route.ts", import.meta.url), "utf8");
  const helper = await readFile(new URL("../lib/dashboard-reset.mjs", import.meta.url), "utf8");

  assert.match(reset, /user\.role !== "super_admin"/);
  assert.match(reset, /body\.confirmation !== "RESET"/);
  assert.match(reset, /clearAllFeedback/);
  assert.match(reset, /writeStateSnapshot/);
  assert.match(helper, /offenceLog: \[\]/);
  assert.match(helper, /demeritPoints: 0/);
  assert.match(helper, /totalPoints: 100/);
  assert.doesNotMatch(helper, /offences: \[\]/);
  assert.doesNotMatch(helper, /sdp: \[\]/);
  assert.doesNotMatch(helper, /wdp: \[\]/);
});
