import assert from "node:assert/strict";
import test from "node:test";
import { resetDisciplinaryState } from "../lib/dashboard-reset.mjs";

test("resets discipline records while preserving master data and personnel", () => {
  const state = {
    offences: [{ id: "rule-1", severity: "Minor", offence: "Test", points: 10 }],
    sdp: [{ band: "15-20", severity: "Low", action: "Reminder", authority: "Manager", min: 15, max: 20 }],
    wdp: [{ band: "15-20", severity: "Low", action: "Reminder", authority: "Manager", min: 15, max: 20 }],
    staffs: [{
      id: "staff-1", employeeId: "S1", name: "Staff One", status: "Active",
      offenceLog: [{ id: "incident-1", label: "Test incident", points: 25, voided: false }],
      demeritPoints: 25, totalPoints: 75, action: "Final reminder",
    }],
    workers: [{
      id: "worker-1", employeeId: "W1", name: "Worker One", status: "Active",
      offenceLog: [], demeritPoints: 0, totalPoints: 100, action: "No Disciplinary Action",
    }],
    meta: { seedVersion: "test" },
  };
  const original = structuredClone(state);
  const reset = resetDisciplinaryState(state, "super-admin", "2026-08-21T12:00:00.000Z");

  assert.deepEqual(state, original, "the input state must not be mutated");
  assert.deepEqual(reset.state.offences, original.offences);
  assert.deepEqual(reset.state.sdp, original.sdp);
  assert.deepEqual(reset.state.wdp, original.wdp);
  assert.equal(reset.state.staffs.length, original.staffs.length);
  assert.equal(reset.state.workers.length, original.workers.length);
  assert.equal(reset.state.staffs[0].employeeId, "S1");
  assert.deepEqual(reset.state.staffs[0].offenceLog, []);
  assert.equal(reset.state.staffs[0].demeritPoints, 0);
  assert.equal(reset.state.staffs[0].totalPoints, 100);
  assert.equal(reset.state.staffs[0].action, "No Disciplinary Action");
  assert.deepEqual(reset.state.workers[0], original.workers[0]);
  assert.equal(reset.clearedPersonnel, 1);
  assert.equal(reset.clearedIncidents, 1);
  assert.equal(reset.clearedPoints, 25);
});
