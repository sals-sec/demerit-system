export const STATE_KEYS = Object.freeze([
  "offences",
  "staffs",
  "workers",
  "sdp",
  "wdp",
  "meta",
]);

const STATE_KEY_SET = new Set(STATE_KEYS);
const MAX_RECORDS_PER_GROUP = 10_000;
const MAX_INCIDENTS_PER_PERSON = 1_000;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value, maxLength, allowEmpty = true) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isOptionalString(value, maxLength) {
  return value === undefined || value === null || isString(value, maxLength);
}

function isFiniteNumber(value, minimum, maximum) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validateIncident(value, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!isOptionalString(value.id, 100)) errors.push(`${path}.id is invalid.`);
  if (!isString(value.label, 1_000, false)) errors.push(`${path}.label is required.`);
  if (!isFiniteNumber(value.points, 0, 100)) errors.push(`${path}.points must be between 0 and 100.`);
  if (!isOptionalString(value.ruleId, 100)) errors.push(`${path}.ruleId is invalid.`);
  if (!isOptionalString(value.date, 100)) errors.push(`${path}.date is invalid.`);
  if (!isOptionalString(value.by, 320)) errors.push(`${path}.by is invalid.`);
  if (value.voided !== undefined && typeof value.voided !== "boolean") {
    errors.push(`${path}.voided must be a boolean.`);
  }
  if (!isOptionalString(value.voidedAt, 100)) errors.push(`${path}.voidedAt is invalid.`);
  if (!isOptionalString(value.voidedBy, 320)) errors.push(`${path}.voidedBy is invalid.`);
}

function validatePeople(value, key, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${key} must contain a list of records.`);
    return;
  }
  if (value.length > MAX_RECORDS_PER_GROUP) {
    errors.push(`${key} cannot contain more than ${MAX_RECORDS_PER_GROUP} records.`);
    return;
  }

  const recordIds = new Set();
  const employeeIds = new Set();
  value.forEach((person, index) => {
    const path = `${key}[${index}]`;
    if (!isObject(person)) {
      errors.push(`${path} must be an object.`);
      return;
    }

    if (!isString(person.id, 100, false)) errors.push(`${path}.id is required.`);
    if (!isString(person.employeeId, 100, false)) errors.push(`${path}.employeeId is required.`);
    if (!isString(person.name, 300, false)) errors.push(`${path}.name is required.`);
    for (const field of ["agent", "designation", "division", "status", "action"]) {
      if (!isOptionalString(person[field], field === "action" ? 1_000 : 300)) {
        errors.push(`${path}.${field} is invalid.`);
      }
    }
    if (!isOptionalString(person.passportNo, 150)) errors.push(`${path}.passportNo is invalid.`);
    if (!isOptionalString(person.shift, 50)) errors.push(`${path}.shift is invalid.`);
    if (!isFiniteNumber(person.demeritPoints, 0, 100)) {
      errors.push(`${path}.demeritPoints must be between 0 and 100.`);
    }
    if (!isFiniteNumber(person.totalPoints, 0, 100)) {
      errors.push(`${path}.totalPoints must be between 0 and 100.`);
    }
    if (
      typeof person.totalPoints === "number" &&
      typeof person.demeritPoints === "number" &&
      Math.abs(person.totalPoints + person.demeritPoints - 100) > 0.000001
    ) {
      errors.push(`${path}.totalPoints and demeritPoints must add up to 100.`);
    }
    if (!Array.isArray(person.offenceLog)) {
      errors.push(`${path}.offenceLog must be a list.`);
    } else if (person.offenceLog.length > MAX_INCIDENTS_PER_PERSON) {
      errors.push(`${path}.offenceLog contains too many incidents.`);
    } else {
      person.offenceLog.forEach((incident, incidentIndex) =>
        validateIncident(incident, `${path}.offenceLog[${incidentIndex}]`, errors),
      );
    }

    const id = typeof person.id === "string" ? person.id.trim().toLowerCase() : "";
    if (id && recordIds.has(id)) errors.push(`${key} contains duplicate record id ${person.id}.`);
    if (id) recordIds.add(id);

    const employeeId =
      typeof person.employeeId === "string" ? person.employeeId.trim().toLowerCase() : "";
    if (employeeId && employeeIds.has(employeeId)) {
      errors.push(`${key} contains duplicate employee id ${person.employeeId}.`);
    }
    if (employeeId) employeeIds.add(employeeId);
  });
}

function validateOffences(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("offences must contain a list of records.");
    return;
  }
  if (value.length > MAX_RECORDS_PER_GROUP) {
    errors.push(`offences cannot contain more than ${MAX_RECORDS_PER_GROUP} records.`);
    return;
  }
  const ids = new Set();
  value.forEach((rule, index) => {
    const path = `offences[${index}]`;
    if (!isObject(rule)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    if (!isString(rule.id, 100, false)) errors.push(`${path}.id is required.`);
    if (!isString(rule.severity, 100, false)) errors.push(`${path}.severity is required.`);
    if (!isString(rule.offence, 1_000, false)) errors.push(`${path}.offence is required.`);
    if (!isFiniteNumber(rule.points, 1, 100)) errors.push(`${path}.points must be between 1 and 100.`);
    if (!isOptionalString(rule.reason, 2_000)) errors.push(`${path}.reason is invalid.`);
    const id = typeof rule.id === "string" ? rule.id.trim().toLowerCase() : "";
    if (id && ids.has(id)) errors.push(`offences contains duplicate id ${rule.id}.`);
    if (id) ids.add(id);
  });
}

function validateThresholds(value, key, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${key} must contain a list of records.`);
    return;
  }
  value.forEach((row, index) => {
    const path = `${key}[${index}]`;
    if (!isObject(row)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    for (const field of ["band", "severity", "action", "authority"]) {
      if (!isString(row[field], field === "action" ? 1_000 : 300, false)) {
        errors.push(`${path}.${field} is required.`);
      }
    }
    if (!isFiniteNumber(row.min, 0, 100) || !isFiniteNumber(row.max, 0, 100)) {
      errors.push(`${path} must have min and max values between 0 and 100.`);
    } else if (row.min > row.max) {
      errors.push(`${path}.min cannot be greater than max.`);
    }
  });
}

export function validateState(state, { partial = false } = {}) {
  const errors = [];
  if (!isObject(state)) return ["A state object is required."];

  for (const key of Object.keys(state)) {
    if (!STATE_KEY_SET.has(key)) errors.push(`Unsupported state key: ${key}.`);
  }
  if (!partial) {
    for (const key of STATE_KEYS) {
      if (!(key in state)) errors.push(`Missing state key: ${key}.`);
    }
  }

  if ("staffs" in state) validatePeople(state.staffs, "staffs", errors);
  if ("workers" in state) validatePeople(state.workers, "workers", errors);
  if ("offences" in state) validateOffences(state.offences, errors);
  if ("sdp" in state) validateThresholds(state.sdp, "sdp", errors);
  if ("wdp" in state) validateThresholds(state.wdp, "wdp", errors);
  if ("meta" in state && !isObject(state.meta)) errors.push("meta must contain an object.");

  return errors;
}

export function mergeState(current, patch) {
  return { ...current, ...patch };
}

export function supportedStatePatch(value) {
  if (!isObject(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => STATE_KEY_SET.has(key)));
}
