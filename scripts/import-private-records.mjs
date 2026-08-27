import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateState } from "../lib/state-validation.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const force = process.argv.includes("--force");

function parseVars(source) {
  const values = {};
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function localConfiguration() {
  let fileValues = {};
  try {
    fileValues = parseVars(await readFile(resolve(projectRoot, ".dev.vars"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ...fileValues, ...process.env };
}

async function readPrivateArray(filename) {
  const source = await readFile(resolve(projectRoot, ".private-data", filename), "utf8");
  const arrayStart = source.indexOf("[");
  const parsed = JSON.parse(arrayStart >= 0 ? source.slice(arrayStart) : source);
  if (!Array.isArray(parsed)) throw new Error(`${filename} must contain a JSON array.`);
  return parsed;
}

function normalizePeople(records, group) {
  let numericEmployeeIds = 0;
  let missingEmployeeIds = 0;
  let numericPassports = 0;
  const people = records.map((source) => {
    const person = { ...source };
    if (typeof person.employeeId === "number") numericEmployeeIds += 1;
    let employeeId = person.employeeId == null ? "" : String(person.employeeId).trim();
    if (!employeeId) {
      missingEmployeeIds += 1;
      employeeId = `UNASSIGNED-${person.id}`;
    }
    person.employeeId = employeeId;

    if (group === "worker" && typeof person.passportNo === "number") {
      numericPassports += 1;
      person.passportNo = String(person.passportNo);
    }
    return person;
  });
  return { people, numericEmployeeIds, missingEmployeeIds, numericPassports };
}

async function responseJson(response, action) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
    throw new Error(`${action} failed (${response.status}): ${payload.error || response.statusText}.${details}`);
  }
  return payload;
}

const configuration = await localConfiguration();
const username = configuration.SALS_ADMIN_USERNAME;
const password = configuration.SALS_ADMIN_PASSWORD;
const baseUrl = String(configuration.SALS_IMPORT_URL || "http://localhost:5173").replace(/\/$/, "");

if (!username || !password) {
  throw new Error("Set SALS_ADMIN_USERNAME and SALS_ADMIN_PASSWORD in .dev.vars or the process environment.");
}

const staffResult = normalizePeople(await readPrivateArray("staff-records.json"), "staff");
const workerResult = normalizePeople(await readPrivateArray("worker-records.json"), "worker");
const patch = { staffs: staffResult.people, workers: workerResult.people };
const validationErrors = validateState(patch, { partial: true });
if (validationErrors.length) {
  throw new Error(`Private records failed validation: ${validationErrors.join(" ")}`);
}

const loginResponse = await fetch(`${baseUrl}/api/auth`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: baseUrl },
  body: JSON.stringify({ username, password }),
});
await responseJson(loginResponse, "Administrator sign-in");
const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Administrator sign-in did not return a session cookie.");

try {
  const stateResponse = await fetch(`${baseUrl}/api/state`, {
    headers: { cookie },
  });
  const current = await responseJson(stateResponse, "Reading the current state");
  const currentStaffCount = Array.isArray(current.state?.staffs) ? current.state.staffs.length : 0;
  const currentWorkerCount = Array.isArray(current.state?.workers) ? current.state.workers.length : 0;
  if (!force && (currentStaffCount || currentWorkerCount)) {
    throw new Error(
      `The database already contains ${currentStaffCount} staff and ${currentWorkerCount} workers. ` +
        "Re-run with --force only if replacing both lists is intentional.",
    );
  }

  const importedAt = new Date().toISOString();
  const updateResponse = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie, origin: baseUrl },
    body: JSON.stringify({
      revision: current.revision,
      state: {
        ...patch,
        meta: {
          ...(current.state?.meta || {}),
          lastImport: "Private recovery import",
          lastImportAt: importedAt,
        },
      },
    }),
  });
  const updated = await responseJson(updateResponse, "Importing private records");
  console.log(
    JSON.stringify(
      {
        staffImported: patch.staffs.length,
        workersImported: patch.workers.length,
        revision: updated.revision,
        normalized: {
          numericStaffEmployeeIds: staffResult.numericEmployeeIds,
          missingStaffEmployeeIds: staffResult.missingEmployeeIds,
          numericWorkerPassports: workerResult.numericPassports,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await fetch(`${baseUrl}/api/auth`, {
    method: "DELETE",
    headers: { cookie, origin: baseUrl },
  }).catch(() => undefined);
}
