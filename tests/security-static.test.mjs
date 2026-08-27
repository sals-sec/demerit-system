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

test("password hashing stays within the Cloudflare Workers PBKDF2 limit", async () => {
  const source = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");
  const match = source.match(/const PASSWORD_ITERATIONS = ([\d_]+);/);

  assert.ok(match, "the password iteration count must be explicitly configured");
  assert.equal(Number(match[1].replaceAll("_", "")), 100_000);
  assert.match(source, /passwordDigest\(password, salt, PASSWORD_ITERATIONS\)/);
  assert.match(source, /UPDATE user_accounts SET name = \? WHERE username = \? AND name <> \?/);
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
  assert.match(users, /updateManagedAccount/);
  assert.match(users, /export async function PATCH/);
  assert.match(users, /user\.role !== "super_admin"/);
  assert.match(users, /export async function DELETE/);
  assert.match(security, /account\.role === "admin" \|\| account\.role === "standard_user"/);
  assert.match(security, /DELETE FROM user_sessions WHERE username = \?/);
  assert.match(security, /You do not have permission to delete this account/);
  assert.match(security, /Only Super Admin can edit user accounts/);
  assert.match(security, /UPDATE feedback_submissions SET submitted_by = \? WHERE submitted_by = \?/);
  assert.match(security, /UPDATE feedback_submissions SET moderated_by = \? WHERE moderated_by = \?/);
  assert.match(security, /UPDATE user_accounts SET created_by = \? WHERE created_by = \?/);
  assert.match(security, /usernameChanged \|\| passwordChanged/);
  assert.match(feedback, /user\.role !== "standard_user"/);
  assert.match(feedback, /user\.role !== "super_admin" && user\.role !== "admin"/);
  assert.match(feedback, /Admin or Super Admin access is required/);
  assert.match(feedback, /appeal_accepted/);
  assert.match(feedback, /body\.status !== "rejected"/);
  assert.match(feedbackStore, /An appeal must be accepted or rejected/);
  assert.match(feedbackStore, /Only an appeal can be rejected/);
  assert.match(feedback, /The selected personnel record no longer exists/);
  assert.match(feedback, /Personnel responses must be an appeal/);
  assert.match(feedback, /subjectPersonId/);
  assert.match(feedback, /subjectGroup/);
});

test("accepted appeals require an atomic, server-enforced reversal of active offence points", async () => {
  const route = await readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");

  assert.match(route, /if \(body\.status === "appeal_accepted"\)/);
  assert.match(route, /!Array\.isArray\(body\.incidentIds\) \|\| !body\.incidentIds\.length/);
  assert.match(route, /acceptAppealWithReversal/);
  assert.match(store, /Accepted appeals must reverse at least one active offence/);
  assert.match(store, /reverseAppealedIncidents\(snapshot\.state/);
  assert.match(store, /await database\.batch\(/);
  assert.match(store, /changes\(\) = 1/);
  assert.match(store, /INSERT INTO audit_events/);
});

test("appeal decisions require and durably store an administrator action comment", async () => {
  const route = await readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0005_appeal_action_comments.sql", import.meta.url), "utf8");

  assert.match(schema, /actionComment: text\("action_comment"\)/);
  assert.match(migration, /ALTER TABLE [`"]?feedback_submissions[`"]? ADD [`"]?action_comment[`"]? text/i);
  assert.match(route, /body\.status === "appeal_accepted" \|\| body\.status === "rejected"/);
  assert.match(route, /validateAppealActionComment\(body\.actionComment\)/);
  assert.match(store, /comment\.trim\(\)\.length < 5/);
  assert.match(store, /comment\.trim\(\)\.length > 2_000/);
  assert.match(store, /action_comment AS actionComment/);
  assert.match(store, /SET status = \?, moderated_by = \?, moderated_at = \?, action_comment = \?/);
  assert.match(store, /status = 'appeal_accepted', moderated_by = \?, moderated_at = \?, action_comment = \?/);
});

test("appeal outcomes are durably recorded and summarized per offence", async () => {
  const store = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");
  const summary = await readFile(new URL("../lib/feedback-summary.mjs", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/disciplinary-policy.mjs", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0006_daily_hellfire_club.sql", import.meta.url), "utf8");

  assert.match(schema, /appealDecisions: text\("appeal_decisions"\)/);
  assert.match(migration, /^ALTER TABLE `feedback_submissions` ADD `appeal_decisions` text;\s*$/);
  assert.match(store, /appeal_decisions AS appealDecisions/);
  assert.match(store, /appealDecisionsForOffences\(reversal\.previousPerson, options\.incidentIds\)/);
  assert.match(store, /summarizeFeedbackItems\(items, snapshot\.state\)/);
  assert.match(summary, /latestByIncident/);
  assert.match(summary, /currentOutcomes\.get\(key\)/);
  assert.match(summary, /decision\.outcome === APPEAL_ACCEPTED/);
  assert.match(summary, /decision\.outcome === REJECTED/);
  assert.match(policy, /accepted\.has\(offence\.id\) \? "appeal_accepted" : "rejected"/);
});

test("reconsidering an accepted appeal atomically restores its points before rejection", async () => {
  const route = await readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/disciplinary-policy.mjs", import.meta.url), "utf8");

  assert.match(route, /body\.status === "rejected" && body\.reconsiderAccepted === true/);
  assert.match(route, /rejectAcceptedAppealWithRestoration/);
  assert.match(route, /restoredPoints: result\.restoredPoints/);
  assert.match(store, /restoreAppealedIncidents\(snapshot\.state/);
  assert.match(store, /status = 'rejected'.*status = 'appeal_accepted' AND type = 'appeal'/);
  assert.match(store, /appeal restoration transaction conflict/);
  assert.match(policy, /entry\.voidedAt === options\.acceptedAt && entry\.voidedBy === options\.acceptedBy/);
  assert.match(policy, /reinstatedAt: resolvedAt, reinstatedBy: options\.actor/);
});

test("reconsidering a rejected appeal remains atomic and reverses selected active points", async () => {
  const route = await readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/feedback-store.ts", import.meta.url), "utf8");

  assert.match(route, /reconsiderRejected\?: unknown/);
  assert.match(route, /body\.reconsiderRejected !== undefined && typeof body\.reconsiderRejected !== "boolean"/);
  assert.match(route, /reconsiderRejected: body\.reconsiderRejected === true/);
  assert.match(store, /const expectedStatus: FeedbackStatus = options\.reconsiderRejected \? "rejected" : "pending"/);
  assert.match(store, /existing\.status !== expectedStatus/);
  assert.match(store, /Only a rejected appeal can be changed to accepted/);
  assert.match(store, /WHERE id = \? AND status = \? AND type = 'appeal'/);
  assert.match(store, /options\.id, expectedStatus\)/);
  assert.match(store, /reverseAppealedIncidents\(snapshot\.state/);
});

test("the live default worker policy is automatically migrated without replacing customized policies", async () => {
  const route = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/disciplinary-policy.mjs", import.meta.url), "utf8");

  assert.match(route, /migrateLegacyWorkerPolicy\(snapshot\.state\)/);
  assert.match(route, /changedKeys: \["wdp", "workers", "meta"\]/);
  assert.match(policy, /if \(!hasLegacyWorkerThresholds\(state\.wdp\)\)/);
  assert.match(policy, /Written Warning \/ Temporary Shift Reassignment/);
  assert.match(policy, /Ban \/ Removal After Final Review/);
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
  assert.match(helper, /employeeId: String\(record\.employeeId \?\? ""\)\.trim\(\)/);
  assert.match(helper, /passportNo: String\(record\.passportNo \?\? ""\)\.trim\(\)/);
  assert.doesNotMatch(helper, /offences: \[\]/);
  assert.doesNotMatch(helper, /sdp: \[\]/);
  assert.doesNotMatch(helper, /wdp: \[\]/);
});
