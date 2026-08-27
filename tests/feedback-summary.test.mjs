import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFeedbackItems } from "../lib/feedback-summary.mjs";

const person = {
  id: "worker-1",
  offenceLog: [
    { id: "offence-1", label: "Uniform", points: 10, voided: true },
    { id: "offence-2", label: "Housekeeping", points: 10, voided: true },
  ],
};

test("Dashboard counts each offence by its current appeal outcome", () => {
  const items = [
    {
      type: "appeal",
      status: "appeal_accepted",
      submittedAt: "2026-08-26T08:46:00.000Z",
      moderatedAt: "2026-08-26T08:46:30.000Z",
      subjectPersonId: "worker-1",
      subjectGroup: "worker",
      appealDecisions: [
        { incidentId: "offence-1", outcome: "appeal_accepted" },
        { incidentId: "offence-2", outcome: "rejected" },
      ],
    },
    {
      type: "appeal",
      status: "appeal_accepted",
      submittedAt: "2026-08-26T08:48:00.000Z",
      moderatedAt: "2026-08-26T08:48:30.000Z",
      subjectPersonId: "worker-1",
      subjectGroup: "worker",
      appealDecisions: [
        { incidentId: "offence-2", outcome: "appeal_accepted" },
      ],
    },
  ];

  assert.deepEqual(summarizeFeedbackItems(items, { workers: [person], staffs: [] }), {
    pending: 0,
    reviewed: 0,
    appealAccepted: 2,
    rejected: 0,
  });
});

test("Dashboard still counts unappealed active offences as rejected", () => {
  const activeSecondOffence = {
    ...person,
    offenceLog: person.offenceLog.map((offence) =>
      offence.id === "offence-2" ? { ...offence, voided: false } : offence
    ),
  };
  const items = [{
    type: "appeal",
    status: "appeal_accepted",
    submittedAt: "2026-08-26T08:46:00.000Z",
    moderatedAt: "2026-08-26T08:46:30.000Z",
    subjectPersonId: "worker-1",
    subjectGroup: "worker",
    appealDecisions: [
      { incidentId: "offence-1", outcome: "appeal_accepted" },
      { incidentId: "offence-2", outcome: "rejected" },
    ],
  }];

  assert.deepEqual(summarizeFeedbackItems(items, { workers: [activeSecondOffence], staffs: [] }), {
    pending: 0,
    reviewed: 0,
    appealAccepted: 1,
    rejected: 1,
  });
});

test("Dashboard deduplicates repeated decisions and preserves general workflow totals", () => {
  const items = [
    { type: "comment", status: "pending", appealDecisions: [] },
    { type: "comment", status: "reviewed", appealDecisions: [] },
    {
      type: "appeal", status: "appeal_accepted", moderatedAt: "2026-08-26T08:46:00.000Z",
      subjectPersonId: "worker-1", subjectGroup: "worker",
      appealDecisions: [{ incidentId: "offence-1", outcome: "appeal_accepted" }],
    },
    {
      type: "appeal", status: "rejected", moderatedAt: "2026-08-26T08:47:00.000Z",
      subjectPersonId: "worker-1", subjectGroup: "worker",
      appealDecisions: [{ incidentId: "offence-1", outcome: "rejected" }],
    },
  ];
  const activePerson = { ...person, offenceLog: [{ ...person.offenceLog[0], voided: false }] };

  assert.deepEqual(summarizeFeedbackItems(items, { workers: [activePerson], staffs: [] }), {
    pending: 1,
    reviewed: 1,
    appealAccepted: 0,
    rejected: 1,
  });
});

test("legacy appeal rows without offence decisions keep their historical total", () => {
  assert.deepEqual(summarizeFeedbackItems([
    { type: "appeal", status: "appeal_accepted", appealDecisions: [] },
    { type: "appeal", status: "rejected", appealDecisions: [] },
  ], {}), {
    pending: 0,
    reviewed: 0,
    appealAccepted: 1,
    rejected: 1,
  });
});
