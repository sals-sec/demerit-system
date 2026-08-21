import { getD1 } from "../db";

export type ApplicationSnapshot = {
  state: Record<string, unknown>;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

type SnapshotRow = {
  value: string;
  revision: number;
  updated_at: string;
  updated_by: string;
};

type AuditChange = {
  category: string;
  entityId: string | null;
  action: "create" | "update" | "delete";
  before: unknown;
  after: unknown;
};

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The stored application snapshot is invalid.");
  }
  return parsed as Record<string, unknown>;
}

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function entityId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

function auditChanges(
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
  keys: string[],
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of keys) {
    if (key === "meta" || !changed(beforeState[key], afterState[key])) continue;
    const before = beforeState[key];
    const after = afterState[key];
    if (Array.isArray(before) && Array.isArray(after) && ["staffs", "workers", "offences"].includes(key)) {
      const beforeById = new Map<string, unknown>();
      const afterById = new Map<string, unknown>();
      for (const item of before) {
        const id = entityId(item);
        if (id) beforeById.set(id, item);
      }
      for (const item of after) {
        const id = entityId(item);
        if (id) afterById.set(id, item);
      }
      const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
      for (const id of ids) {
        const oldValue = beforeById.get(id);
        const newValue = afterById.get(id);
        if (!changed(oldValue, newValue)) continue;
        changes.push({
          category: key,
          entityId: String(id),
          action: oldValue === undefined ? "create" : newValue === undefined ? "delete" : "update",
          before: oldValue ?? null,
          after: newValue ?? null,
        });
      }
      continue;
    }
    changes.push({
      category: key,
      entityId: null,
      action: before === undefined ? "create" : after === undefined ? "delete" : "update",
      before: before ?? null,
      after: after ?? null,
    });
  }
  return changes;
}

export async function ensureStateSnapshot(): Promise<void> {
  const database = getD1();
  const existing = await database
    .prepare("SELECT id FROM application_snapshot WHERE id = 1")
    .first();
  if (existing) return;

  const legacy = await database
    .prepare("SELECT key, value, updated_at, updated_by FROM application_state")
    .all<{ key: string; value: string; updated_at: string; updated_by: string }>();
  const state: Record<string, unknown> = {};
  let updatedAt = "";
  let updatedBy = "secure snapshot migration";
  for (const row of legacy.results || []) {
    if (!new Set(["offences", "staffs", "workers", "sdp", "wdp", "meta"]).has(row.key)) continue;
    state[row.key] = JSON.parse(row.value);
    if (row.updated_at > updatedAt) {
      updatedAt = row.updated_at;
      updatedBy = row.updated_by;
    }
  }
  if (!updatedAt) updatedAt = new Date().toISOString();

  await database
    .prepare(
      "INSERT OR IGNORE INTO application_snapshot (id, value, revision, updated_at, updated_by) VALUES (1, ?, 1, ?, ?)",
    )
    .bind(JSON.stringify(state), updatedAt, updatedBy)
    .run();
}

export async function readStateSnapshot(): Promise<ApplicationSnapshot> {
  await ensureStateSnapshot();
  const row = await getD1()
    .prepare("SELECT value, revision, updated_at, updated_by FROM application_snapshot WHERE id = 1")
    .first<SnapshotRow>();
  if (!row) throw new Error("The application snapshot could not be initialized.");
  return {
    state: parseObject(row.value),
    revision: row.revision,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function writeStateSnapshot(options: {
  expectedRevision: number;
  state: Record<string, unknown>;
  previousState: Record<string, unknown>;
  changedKeys: string[];
  actor: string;
}): Promise<{ ok: true; revision: number; updatedAt: string } | { ok: false; current: ApplicationSnapshot }> {
  const database = getD1();
  const updatedAt = new Date().toISOString();
  const nextRevision = options.expectedRevision + 1;
  const result = await database
    .prepare(
      "UPDATE application_snapshot SET value = ?, revision = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?",
    )
    .bind(
      JSON.stringify(options.state),
      nextRevision,
      updatedAt,
      options.actor,
      options.expectedRevision,
    )
    .run();

  if ((result.meta?.changes ?? 0) !== 1) {
    return { ok: false, current: await readStateSnapshot() };
  }

  const changes = auditChanges(options.previousState, options.state, options.changedKeys);
  for (let offset = 0; offset < changes.length; offset += 50) {
    const chunk = changes.slice(offset, offset + 50);
    await database.batch(
      chunk.map((change) =>
        database
          .prepare(
            "INSERT INTO audit_events (id, category, entity_id, action, before_value, after_value, actor, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            change.category,
            change.entityId,
            change.action,
            change.before === null ? null : JSON.stringify(change.before),
            change.after === null ? null : JSON.stringify(change.after),
            options.actor,
            nextRevision,
            updatedAt,
          ),
      ),
    );
  }

  return { ok: true, revision: nextRevision, updatedAt };
}
