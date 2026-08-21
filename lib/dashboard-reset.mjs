const CLEAN_ACTION = "No Disciplinary Action";

function resetPeople(records, actor, resetAt) {
  if (!Array.isArray(records)) return { records, clearedPersonnel: 0, clearedIncidents: 0, clearedPoints: 0 };

  let clearedPersonnel = 0;
  let clearedIncidents = 0;
  let clearedPoints = 0;
  const nextRecords = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    const incidents = Array.isArray(record.offenceLog) ? record.offenceLog : [];
    const points = typeof record.demeritPoints === "number" && Number.isFinite(record.demeritPoints)
      ? record.demeritPoints
      : 0;
    const needsReset = incidents.length > 0 || points !== 0 || record.totalPoints !== 100 || record.action !== CLEAN_ACTION;
    if (!needsReset) return record;

    clearedPersonnel += 1;
    clearedIncidents += incidents.length;
    clearedPoints += points;
    return {
      ...record,
      offenceLog: [],
      demeritPoints: 0,
      totalPoints: 100,
      action: CLEAN_ACTION,
      lastModifiedBy: actor,
      lastModifiedAt: resetAt,
    };
  });

  return { records: nextRecords, clearedPersonnel, clearedIncidents, clearedPoints };
}

export function resetDisciplinaryState(state, actor, resetAt = new Date().toISOString()) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("A valid application state is required.");
  }
  const staffs = resetPeople(state.staffs, actor, resetAt);
  const workers = resetPeople(state.workers, actor, resetAt);
  const meta = state.meta && typeof state.meta === "object" && !Array.isArray(state.meta) ? state.meta : {};
  return {
    state: {
      ...state,
      staffs: staffs.records,
      workers: workers.records,
      meta: {
        ...meta,
        lastResetAt: resetAt,
        lastResetBy: actor,
        lastUpdated: resetAt,
        lastModifiedBy: actor,
      },
    },
    clearedPersonnel: staffs.clearedPersonnel + workers.clearedPersonnel,
    clearedIncidents: staffs.clearedIncidents + workers.clearedIncidents,
    clearedPoints: staffs.clearedPoints + workers.clearedPoints,
  };
}
