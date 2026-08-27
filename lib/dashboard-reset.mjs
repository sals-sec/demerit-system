const CLEAN_ACTION = "No Disciplinary Action";

function resetPeople(records, actor, resetAt) {
  if (!Array.isArray(records)) return { records, clearedPersonnel: 0, clearedIncidents: 0, clearedPoints: 0 };

  let clearedPersonnel = 0;
  let clearedIncidents = 0;
  let clearedPoints = 0;
  const nextRecords = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    // Normalize spreadsheet identifiers before validating the complete reset state.
    // Excel can import numeric employee and passport values even though the app stores strings.
    const normalizedRecord = {
      ...record,
      employeeId: String(record.employeeId ?? "").trim(),
      ...(Object.hasOwn(record, "passportNo")
        ? { passportNo: String(record.passportNo ?? "").trim() }
        : {}),
    };
    const incidents = Array.isArray(normalizedRecord.offenceLog) ? normalizedRecord.offenceLog : [];
    const points = typeof normalizedRecord.demeritPoints === "number" && Number.isFinite(normalizedRecord.demeritPoints)
      ? normalizedRecord.demeritPoints
      : 0;
    const needsReset = incidents.length > 0 || points !== 0 || normalizedRecord.totalPoints !== 100 || normalizedRecord.action !== CLEAN_ACTION;
    if (!needsReset) return normalizedRecord;

    clearedPersonnel += 1;
    clearedIncidents += incidents.length;
    clearedPoints += points;
    return {
      ...normalizedRecord,
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
