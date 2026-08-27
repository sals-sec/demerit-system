const APPEAL_ACCEPTED = "appeal_accepted";
const REJECTED = "rejected";

function decisionKey(item, incidentId) {
  const group = item?.subjectGroup === "staff" || item?.subjectGroup === "worker"
    ? item.subjectGroup
    : "unknown";
  const personId = typeof item?.subjectPersonId === "string" && item.subjectPersonId
    ? item.subjectPersonId
    : "unknown";
  return `${group}:${personId}:${incidentId}`;
}

function currentIncidentOutcomes(state) {
  const outcomes = new Map();
  for (const [group, records] of [["staff", state?.staffs], ["worker", state?.workers]]) {
    if (!Array.isArray(records)) continue;
    for (const person of records) {
      if (!person || typeof person !== "object" || typeof person.id !== "string") continue;
      const offences = Array.isArray(person.offenceLog) ? person.offenceLog : [];
      for (const offence of offences) {
        if (!offence || typeof offence !== "object" || typeof offence.id !== "string" || !offence.id) continue;
        outcomes.set(
          `${group}:${person.id}:${offence.id}`,
          offence.voided ? APPEAL_ACCEPTED : REJECTED,
        );
      }
    }
  }
  return outcomes;
}

function decisionTime(item, index) {
  const parsed = Date.parse(item?.moderatedAt || item?.submittedAt || "");
  return Number.isFinite(parsed) ? parsed : index;
}

export function summarizeFeedbackItems(items, state) {
  const summary = { pending: 0, reviewed: 0, appealAccepted: 0, rejected: 0 };
  const latestByIncident = new Map();
  const currentOutcomes = currentIncidentOutcomes(state);
  let legacyAppealAccepted = 0;
  let legacyRejected = 0;

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    if (item.status === "pending") summary.pending += 1;
    if (item.status === "reviewed") summary.reviewed += 1;
    if (item.type !== "appeal" || (item.status !== APPEAL_ACCEPTED && item.status !== REJECTED)) return;

    const decisions = Array.isArray(item.appealDecisions)
      ? item.appealDecisions.filter((decision) =>
          decision && typeof decision.incidentId === "string" && decision.incidentId &&
          (decision.outcome === APPEAL_ACCEPTED || decision.outcome === REJECTED)
        )
      : [];
    if (!decisions.length) {
      if (item.status === APPEAL_ACCEPTED) legacyAppealAccepted += 1;
      if (item.status === REJECTED) legacyRejected += 1;
      return;
    }

    const resolvedAt = decisionTime(item, index);
    for (const decision of decisions) {
      const key = decisionKey(item, decision.incidentId);
      const currentOutcome = currentOutcomes.get(key);
      const existing = latestByIncident.get(key);
      if (currentOutcome || !existing || resolvedAt >= existing.resolvedAt) {
        latestByIncident.set(key, {
          outcome: currentOutcome || decision.outcome,
          resolvedAt,
        });
      }
    }
  });

  summary.appealAccepted = legacyAppealAccepted;
  summary.rejected = legacyRejected;
  for (const decision of latestByIncident.values()) {
    if (decision.outcome === APPEAL_ACCEPTED) summary.appealAccepted += 1;
    if (decision.outcome === REJECTED) summary.rejected += 1;
  }
  return summary;
}
