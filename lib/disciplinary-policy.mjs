export const GRADUATED_WORKER_THRESHOLDS = Object.freeze([
  Object.freeze({ band: "85-100", severity: "Major", action: "Ban / Removal After Final Review", authority: "Management + Agency", min: 85, max: 100 }),
  Object.freeze({ band: "70-84", severity: "Major", action: "Suspension (3-7 days) / Final Management Review", authority: "Management + Agency", min: 70, max: 84 }),
  Object.freeze({ band: "61-69", severity: "Minor to Major", action: "Final Written Warning / Suspension (up to 3 days)", authority: "Management + Agency", min: 61, max: 69 }),
  Object.freeze({ band: "51-60", severity: "Minor", action: "Written Warning / Temporary Shift Reassignment", authority: "Security + Management", min: 51, max: 60 }),
  Object.freeze({ band: "41-50", severity: "Low to Minor", action: "Investigation and Interview Session", authority: "Security", min: 41, max: 50 }),
  Object.freeze({ band: "21-40", severity: "Low", action: "Final Verbal Reminder (On-the-Spot)", authority: "Security", min: 21, max: 40 }),
  Object.freeze({ band: "15-20", severity: "Low", action: "Verbal Reminder (On-the-Spot)", authority: "Security", min: 15, max: 20 }),
]);

const LEGACY_WORKER_ACTIONS = new Map([
  ["70-100", "Banned"],
  ["61-69", "Suspension (7 days - 30 days)"],
  ["51-60", "Suspension (3 days)"],
  ["41-50", "Investigation and Interview Session"],
  ["21-40", "Final Verbal Reminder (On-the-Spot)"],
  ["15-20", "Verbal Reminder (On-the-Spot)"],
]);

function policyAction(points, rows) {
  const match = [...rows]
    .sort((left, right) => Number(right.min) - Number(left.min))
    .find((row) => points >= Number(row.min) && points <= Number(row.max));
  return points > 0 && match ? String(match.action) : "No Disciplinary Action";
}

export function hasLegacyWorkerThresholds(rows) {
  return Array.isArray(rows) &&
    rows.length === LEGACY_WORKER_ACTIONS.size &&
    rows.every((row) =>
      !!row && typeof row === "object" &&
      LEGACY_WORKER_ACTIONS.get(String(row.band).trim()) === String(row.action).trim()
    );
}

export function migrateLegacyWorkerPolicy(state, migratedAt = new Date().toISOString()) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("A valid application state is required.");
  }
  if (!hasLegacyWorkerThresholds(state.wdp)) return { changed: false, state };

  const thresholds = GRADUATED_WORKER_THRESHOLDS.map((row) => ({ ...row }));
  const workers = Array.isArray(state.workers)
    ? state.workers.map((worker) => {
      if (!worker || typeof worker !== "object" || Array.isArray(worker)) return worker;
      const points = Math.min(100, Math.max(0, Number(worker.demeritPoints) || 0));
      return {
        ...worker,
        employeeId: String(worker.employeeId ?? "").trim(),
        ...(Object.hasOwn(worker, "passportNo")
          ? { passportNo: String(worker.passportNo ?? "").trim() }
          : {}),
        demeritPoints: points,
        totalPoints: 100 - points,
        action: policyAction(points, thresholds),
      };
    })
    : state.workers;
  const meta = state.meta && typeof state.meta === "object" && !Array.isArray(state.meta)
    ? state.meta
    : {};

  return {
    changed: true,
    state: {
      ...state,
      workers,
      wdp: thresholds,
      meta: {
        ...meta,
        workerPolicyVersion: "graduated-worker-policy-v1",
        workerPolicyMigratedAt: migratedAt,
        lastUpdated: migratedAt,
        lastModifiedBy: "system policy migration",
      },
    },
  };
}

export function appealDecisionsForOffences(person, acceptedIncidentIds = []) {
  if (!person || typeof person !== "object" || Array.isArray(person)) return [];
  const offences = Array.isArray(person.offenceLog) ? person.offenceLog : [];
  const accepted = new Set(acceptedIncidentIds);
  return offences.flatMap((offence) => {
    if (!offence || typeof offence !== "object" || Array.isArray(offence)) return [];
    if (offence.voided || typeof offence.id !== "string" || !offence.id) return [];
    return [{
      incidentId: offence.id,
      label: typeof offence.label === "string" && offence.label ? offence.label : "Recorded offence",
      points: Math.max(0, Number(offence.points) || 0),
      outcome: accepted.has(offence.id) ? "appeal_accepted" : "rejected",
    }];
  });
}

export function reverseAppealedIncidents(state, options) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("A valid application state is required.");
  }
  if (options.subjectGroup !== "staff" && options.subjectGroup !== "worker") {
    throw new Error("Choose the staff or worker record covered by this appeal.");
  }
  const requestedIds = Array.isArray(options.incidentIds)
    ? options.incidentIds.map((id) => typeof id === "string" ? id.trim() : "")
    : [];
  if (!requestedIds.length || requestedIds.some((id) => !id || id.length > 100)) {
    throw new Error("Select at least one active offence to reverse before accepting the appeal.");
  }
  if (new Set(requestedIds).size !== requestedIds.length || requestedIds.length > 1_000) {
    throw new Error("Each appealed offence must be selected only once.");
  }

  const groupKey = options.subjectGroup === "staff" ? "staffs" : "workers";
  const records = state[groupKey];
  if (!Array.isArray(records)) throw new Error("The selected personnel records are unavailable.");
  const index = records.findIndex((record) =>
    !!record && typeof record === "object" && record.id === options.subjectPersonId
  );
  if (index === -1) throw new Error("The selected personnel record no longer exists.");

  const previousPerson = records[index];
  const incidents = Array.isArray(previousPerson.offenceLog) ? previousPerson.offenceLog : [];
  const activeById = new Map(incidents.filter((entry) => !entry.voided).map((entry) => [entry.id, entry]));
  if (requestedIds.some((id) => !activeById.has(id))) {
    throw new Error("Every selected offence must still be active before the appeal can be accepted.");
  }

  const selected = new Set(requestedIds);
  const resolvedAt = options.resolvedAt || new Date().toISOString();
  const offenceLog = incidents.map((entry) => selected.has(entry.id)
    ? { ...entry, voided: true, voidedAt: resolvedAt, voidedBy: options.actor }
    : { ...entry });
  const demeritPoints = Math.min(100, Math.max(0, offenceLog.reduce(
    (sum, entry) => sum + (entry.voided ? 0 : (Number(entry.points) || 0)), 0,
  )));
  const thresholds = state[options.subjectGroup === "staff" ? "sdp" : "wdp"];
  const person = {
    ...previousPerson,
    employeeId: String(previousPerson.employeeId ?? "").trim(),
    ...(Object.hasOwn(previousPerson, "passportNo")
      ? { passportNo: String(previousPerson.passportNo ?? "").trim() }
      : {}),
    offenceLog,
    demeritPoints,
    totalPoints: 100 - demeritPoints,
    action: policyAction(demeritPoints, Array.isArray(thresholds) ? thresholds : []),
    lastModifiedBy: options.actor,
    lastModifiedAt: resolvedAt,
  };
  const nextRecords = records.slice();
  nextRecords[index] = person;
  const meta = state.meta && typeof state.meta === "object" && !Array.isArray(state.meta)
    ? state.meta
    : {};

  return {
    state: {
      ...state,
      [groupKey]: nextRecords,
      meta: { ...meta, lastUpdated: resolvedAt, lastModifiedBy: options.actor },
    },
    groupKey,
    previousPerson,
    person,
    reversedCount: requestedIds.length,
    reversedPoints: requestedIds.reduce((sum, id) => sum + (Number(activeById.get(id).points) || 0), 0),
    resolvedAt,
  };
}

export function restoreAppealedIncidents(state, options) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("A valid application state is required.");
  }
  if (options.subjectGroup !== "staff" && options.subjectGroup !== "worker") {
    throw new Error("The accepted appeal must be linked to a staff or worker record.");
  }
  if (!options.acceptedAt || !options.acceptedBy) {
    throw new Error("The accepted appeal is missing the decision details needed to restore its offences.");
  }

  const groupKey = options.subjectGroup === "staff" ? "staffs" : "workers";
  const records = state[groupKey];
  if (!Array.isArray(records)) throw new Error("The selected personnel records are unavailable.");
  const index = records.findIndex((record) =>
    !!record && typeof record === "object" && record.id === options.subjectPersonId
  );
  if (index === -1) throw new Error("The selected personnel record no longer exists.");

  const previousPerson = records[index];
  const incidents = Array.isArray(previousPerson.offenceLog) ? previousPerson.offenceLog : [];
  const restored = incidents.filter((entry) =>
    entry.voided && entry.voidedAt === options.acceptedAt && entry.voidedBy === options.acceptedBy
  );
  if (!restored.length) {
    throw new Error("The offences reversed by this accepted appeal are no longer available to restore.");
  }

  const restoredIds = new Set(restored.map((entry) => entry.id));
  const resolvedAt = options.resolvedAt || new Date().toISOString();
  const offenceLog = incidents.map((entry) => restoredIds.has(entry.id)
    ? { ...entry, voided: false, reinstatedAt: resolvedAt, reinstatedBy: options.actor }
    : { ...entry });
  const demeritPoints = Math.min(100, Math.max(0, offenceLog.reduce(
    (sum, entry) => sum + (entry.voided ? 0 : (Number(entry.points) || 0)), 0,
  )));
  const thresholds = state[options.subjectGroup === "staff" ? "sdp" : "wdp"];
  const person = {
    ...previousPerson,
    employeeId: String(previousPerson.employeeId ?? "").trim(),
    ...(Object.hasOwn(previousPerson, "passportNo")
      ? { passportNo: String(previousPerson.passportNo ?? "").trim() }
      : {}),
    offenceLog,
    demeritPoints,
    totalPoints: 100 - demeritPoints,
    action: policyAction(demeritPoints, Array.isArray(thresholds) ? thresholds : []),
    lastModifiedBy: options.actor,
    lastModifiedAt: resolvedAt,
  };
  const nextRecords = records.slice();
  nextRecords[index] = person;
  const meta = state.meta && typeof state.meta === "object" && !Array.isArray(state.meta)
    ? state.meta
    : {};

  return {
    state: {
      ...state,
      [groupKey]: nextRecords,
      meta: { ...meta, lastUpdated: resolvedAt, lastModifiedBy: options.actor },
    },
    groupKey,
    previousPerson,
    person,
    restoredCount: restored.length,
    restoredPoints: restored.reduce((sum, incident) => sum + (Number(incident.points) || 0), 0),
    resolvedAt,
  };
}
