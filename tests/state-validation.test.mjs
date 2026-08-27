import assert from "node:assert/strict";
import test from "node:test";
import { mergeState, validateState, validateStateGroups } from "../lib/state-validation.mjs";

function person(overrides = {}) {
  return {
    id: "STF001",
    employeeId: "E001",
    name: "Example Person",
    agent: "SALS",
    designation: "Operator",
    division: "Operations",
    status: "Active",
    demeritPoints: 0,
    totalPoints: 100,
    offenceLog: [],
    action: "No Disciplinary Action",
    ...overrides,
  };
}

test("accepts a valid personnel patch", () => {
  assert.deepEqual(validateState({ staffs: [person()] }, { partial: true }), []);
});

test("accepts legacy missing employee IDs but rejects duplicate populated IDs", () => {
  const errors = validateState(
    { staffs: [person({ employeeId: "" }), person({ id: "STF002", employeeId: "E001" }), person({ id: "STF003", employeeId: "e001" })] },
    { partial: true },
  );
  assert.ok(!errors.some((error) => error.includes("staffs[0].employeeId")));
  assert.ok(errors.some((error) => error.includes("duplicate employee id")));
});

test("rejects malformed incident points", () => {
  const errors = validateState(
    { staffs: [person({ offenceLog: [{ id: "INC1", label: "Unsafe act", points: 101, voided: false }] })] },
    { partial: true },
  );
  assert.ok(errors.some((error) => error.includes("points must be between 0 and 100")));
});

test("merges a patch without dropping unrelated state groups", () => {
  const current = { staffs: [person()], workers: [], meta: { seedVersion: "1" } };
  const next = mergeState(current, { workers: [person({ id: "W1", employeeId: "W1" })] });
  assert.equal(next.staffs, current.staffs);
  assert.equal(next.workers.length, 1);
  assert.deepEqual(next.meta, { seedVersion: "1" });
});

test("validates only changed groups so unrelated legacy gaps do not block saves", () => {
  const current = {
    offences: [],
    staffs: [person({ totalPoints: 90, demeritPoints: 0 })],
    meta: { seedVersion: "1" },
  };
  const next = mergeState(current, {
    offences: [{ id: "RULE1", severity: "Low Offence", offence: "Test", points: 10, reason: "Test" }],
    meta: { seedVersion: "1", lastUpdated: "2026-08-22T00:00:00.000Z" },
  });

  assert.deepEqual(validateStateGroups(next, ["offences", "meta"]), []);
  assert.ok(validateStateGroups(next, ["staffs"]).some((error) => error.includes("add up to 100")));
});
