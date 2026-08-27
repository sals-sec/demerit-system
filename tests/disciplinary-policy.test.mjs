import assert from "node:assert/strict";
import test from "node:test";
import {
  GRADUATED_WORKER_THRESHOLDS,
  appealDecisionsForOffences,
  hasLegacyWorkerThresholds,
  migrateLegacyWorkerPolicy,
  restoreAppealedIncidents,
  reverseAppealedIncidents,
} from "../lib/disciplinary-policy.mjs";

const legacy = [
  { band: "70-100", severity: "Major", action: "Banned", authority: "Management", min: 70, max: 100 },
  { band: "61-69", severity: "Minor to Major", action: "Suspension (7 days - 30 days)", authority: "Management", min: 61, max: 69 },
  { band: "51-60", severity: "Minor", action: "Suspension (3 days)", authority: "Management", min: 51, max: 60 },
  { band: "41-50", severity: "Low to Minor", action: "Investigation and Interview Session", authority: "Security", min: 41, max: 50 },
  { band: "21-40", severity: "Low", action: "Final Verbal Reminder (On-the-Spot)", authority: "Security", min: 21, max: 40 },
  { band: "15-20", severity: "Low", action: "Verbal Reminder (On-the-Spot)", authority: "Security", min: 15, max: 20 },
];

function fixture() {
  return {
    staffs: [],
    workers: [{
      id: "worker-1", employeeId: 101, passportNo: 909, name: "Worker One",
      demeritPoints: 75, totalPoints: 25, action: "Banned",
      offenceLog: [
        { id: "incident-1", label: "First offence", points: 55, voided: false },
        { id: "incident-2", label: "Second offence", points: 20, voided: false },
        { id: "incident-3", label: "Past appeal", points: 8, voided: true },
      ],
    }],
    sdp: [],
    wdp: legacy.map((row) => ({ ...row })),
    meta: { lastImport: "existing.xlsx" },
  };
}

test("migrates only the exact old worker policy and recalculates existing worker actions", () => {
  const state = fixture();
  const result = migrateLegacyWorkerPolicy(state, "2026-08-24T00:00:00.000Z");

  assert.equal(hasLegacyWorkerThresholds(state.wdp), true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.wdp, GRADUATED_WORKER_THRESHOLDS);
  assert.equal(result.state.workers[0].action, "Suspension (3-7 days) / Final Management Review");
  assert.equal(result.state.workers[0].employeeId, "101");
  assert.equal(result.state.workers[0].passportNo, "909");
  assert.equal(result.state.workers[0].offenceLog.length, 3);
  assert.equal(result.state.meta.workerPolicyVersion, "graduated-worker-policy-v1");
  assert.equal(state.workers[0].action, "Banned");

  const customized = fixture();
  customized.wdp[2].action = "Custom agency review";
  assert.equal(migrateLegacyWorkerPolicy(customized).changed, false);
});

test("provides a reassignment stage and does not ban workers at 70 points", () => {
  const stage = GRADUATED_WORKER_THRESHOLDS.find((row) => row.min === 51);
  const major = GRADUATED_WORKER_THRESHOLDS.find((row) => row.min === 70);
  const final = GRADUATED_WORKER_THRESHOLDS.find((row) => row.min === 85);

  assert.match(stage.action, /Written Warning.*Temporary Shift Reassignment/);
  assert.doesNotMatch(major.action, /ban/i);
  assert.match(final.action, /Ban.*Final Review/);
  assert.match(final.authority, /Agency/);
});

test("acceptance reverses only selected active incidents and preserves the audit history", () => {
  const state = migrateLegacyWorkerPolicy(fixture()).state;
  const result = reverseAppealedIncidents(state, {
    subjectGroup: "worker", subjectPersonId: "worker-1", incidentIds: ["incident-1"],
    actor: "reviewer", resolvedAt: "2026-08-24T00:05:00.000Z",
  });

  assert.equal(result.reversedCount, 1);
  assert.equal(result.reversedPoints, 55);
  assert.equal(result.person.demeritPoints, 20);
  assert.equal(result.person.totalPoints, 80);
  assert.equal(result.person.action, "Verbal Reminder (On-the-Spot)");
  assert.deepEqual(result.person.offenceLog[0], {
    id: "incident-1", label: "First offence", points: 55, voided: true,
    voidedAt: "2026-08-24T00:05:00.000Z", voidedBy: "reviewer",
  });
  assert.equal(result.person.offenceLog[1].voided, false);
  assert.equal(result.person.offenceLog[2].voided, true);
  assert.equal(state.workers[0].offenceLog[0].voided, false);
});

test("appeal decisions are counted per active offence", () => {
  const person = {
    offenceLog: [
      { id: "incident-1", label: "Accepted offence", points: 20, voided: false },
      { id: "incident-2", label: "Rejected offence two", points: 15, voided: false },
      { id: "incident-3", label: "Rejected offence three", points: 10, voided: false },
      { id: "incident-old", label: "Previously voided", points: 5, voided: true },
    ],
  };

  assert.deepEqual(appealDecisionsForOffences(person, ["incident-1"]), [
    { incidentId: "incident-1", label: "Accepted offence", points: 20, outcome: "appeal_accepted" },
    { incidentId: "incident-2", label: "Rejected offence two", points: 15, outcome: "rejected" },
    { incidentId: "incident-3", label: "Rejected offence three", points: 10, outcome: "rejected" },
  ]);
});

test("rejects acceptance without a valid, active, uniquely selected offence", () => {
  const state = fixture();
  const options = { subjectGroup: "worker", subjectPersonId: "worker-1", actor: "reviewer" };

  assert.throws(() => reverseAppealedIncidents(state, { ...options, incidentIds: [] }), /at least one active offence/);
  assert.throws(() => reverseAppealedIncidents(state, { ...options, incidentIds: ["incident-3"] }), /must still be active/);
  assert.throws(() => reverseAppealedIncidents(state, { ...options, incidentIds: ["incident-1", "incident-1"] }), /only once/);
  assert.throws(() => reverseAppealedIncidents(state, { ...options, subjectPersonId: "missing", incidentIds: ["incident-1"] }), /no longer exists/);
});

test("changing an accepted appeal to rejected restores only that appeal's offences and points", () => {
  const state = migrateLegacyWorkerPolicy(fixture()).state;
  const accepted = reverseAppealedIncidents(state, {
    subjectGroup: "worker", subjectPersonId: "worker-1", incidentIds: ["incident-1"],
    actor: "original-admin", resolvedAt: "2026-08-24T00:05:00.000Z",
  });
  const restored = restoreAppealedIncidents(accepted.state, {
    subjectGroup: "worker", subjectPersonId: "worker-1",
    acceptedAt: "2026-08-24T00:05:00.000Z", acceptedBy: "original-admin",
    actor: "reviewing-admin", resolvedAt: "2026-08-24T00:15:00.000Z",
  });

  assert.equal(restored.restoredCount, 1);
  assert.equal(restored.restoredPoints, 55);
  assert.equal(restored.person.demeritPoints, 75);
  assert.equal(restored.person.totalPoints, 25);
  assert.equal(restored.person.action, "Suspension (3-7 days) / Final Management Review");
  assert.equal(restored.person.offenceLog[0].voided, false);
  assert.equal(restored.person.offenceLog[0].voidedAt, "2026-08-24T00:05:00.000Z");
  assert.equal(restored.person.offenceLog[0].reinstatedAt, "2026-08-24T00:15:00.000Z");
  assert.equal(restored.person.offenceLog[0].reinstatedBy, "reviewing-admin");
  assert.equal(restored.person.offenceLog[2].voided, true);
  assert.equal(accepted.person.offenceLog[0].voided, true);
});

test("rejects restoring incidents unrelated to the accepted appeal decision", () => {
  const state = fixture();
  const options = {
    subjectGroup: "worker", subjectPersonId: "worker-1", actor: "reviewing-admin",
    acceptedAt: "2026-08-24T00:05:00.000Z", acceptedBy: "original-admin",
  };

  assert.throws(() => restoreAppealedIncidents(state, options), /no longer available to restore/);
  assert.throws(() => restoreAppealedIncidents(state, { ...options, acceptedBy: "" }), /missing the decision details/);
  assert.throws(() => restoreAppealedIncidents(state, { ...options, subjectPersonId: "missing" }), /no longer exists/);
});
