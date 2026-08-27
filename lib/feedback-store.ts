import { getD1 } from "../db";
import { appealDecisionsForOffences, restoreAppealedIncidents, reverseAppealedIncidents } from "./disciplinary-policy.mjs";
import { summarizeFeedbackItems } from "./feedback-summary.mjs";
import type { AuthenticatedUser } from "./security";
import { readStateSnapshot } from "./state-store";
import { validateStateGroups } from "./state-validation.mjs";

export const FEEDBACK_TYPES = ["comment", "review", "suggestion", "appeal"] as const;
export const FEEDBACK_STATUSES = ["pending", "reviewed", "appeal_accepted", "rejected"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type AppealIncidentDecision = {
  incidentId: string;
  label: string;
  points: number;
  outcome: "appeal_accepted" | "rejected";
};

export type FeedbackItem = {
  id: string;
  type: FeedbackType;
  body: string;
  status: FeedbackStatus;
  submittedBy: string;
  submittedAt: string;
  moderatedBy: string | null;
  moderatedAt: string | null;
  actionComment: string | null;
  appealDecisions: AppealIncidentDecision[];
  subjectPersonId: string | null;
  subjectGroup: "staff" | "worker" | null;
};

type FeedbackSummary = { pending: number; reviewed: number; appealAccepted: number; rejected: number };
type FeedbackRow = Omit<FeedbackItem, "appealDecisions"> & { appealDecisions: string | null };
type FeedbackSummaryRow = Pick<FeedbackItem, "type" | "status" | "submittedAt" | "moderatedAt" | "subjectPersonId" | "subjectGroup"> & { appealDecisions: string | null };

const FEEDBACK_SELECT = "SELECT id, type, body, status, submitted_by AS submittedBy, submitted_at AS submittedAt, moderated_by AS moderatedBy, moderated_at AS moderatedAt, action_comment AS actionComment, appeal_decisions AS appealDecisions, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions";

export function parseAppealDecisions(value: unknown): AppealIncidentDecision[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((decision) => {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) return [];
    const item = decision as Record<string, unknown>;
    if (
      typeof item.incidentId !== "string" || !item.incidentId ||
      typeof item.label !== "string" ||
      (item.outcome !== "appeal_accepted" && item.outcome !== "rejected")
    ) return [];
    return [{
      incidentId: item.incidentId,
      label: item.label,
      points: Math.max(0, Number(item.points) || 0),
      outcome: item.outcome,
    }];
  });
}

function feedbackItemFromRow(row: FeedbackRow): FeedbackItem {
  return { ...row, appealDecisions: parseAppealDecisions(row.appealDecisions) };
}

export function validateFeedback(type: unknown, body: unknown): string | null {
  if (typeof type !== "string" || !FEEDBACK_TYPES.includes(type as FeedbackType)) {
    return "Choose comment, review, suggestion, or appeal.";
  }
  if (typeof body !== "string" || body.trim().length < 5) {
    return "Feedback must contain at least 5 characters.";
  }
  if (body.length > 5_000) return "Feedback cannot exceed 5,000 characters.";
  return null;
}

export function validateAppealActionComment(comment: unknown): string | null {
  if (typeof comment !== "string" || comment.trim().length < 5) {
    return "Describe the action taken or the reason for the appeal decision in at least 5 characters.";
  }
  if (comment.trim().length > 2_000) {
    return "The appeal action comment cannot exceed 2,000 characters.";
  }
  return null;
}

export async function feedbackSummary(): Promise<FeedbackSummary> {
  const result = await getD1()
    .prepare("SELECT type, status, submitted_at AS submittedAt, moderated_at AS moderatedAt, appeal_decisions AS appealDecisions, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions ORDER BY submitted_at ASC")
    .all<FeedbackSummaryRow>();
  const items = (result.results || []).map((row) => ({
    ...row,
    appealDecisions: parseAppealDecisions(row.appealDecisions),
  }));
  const snapshot = await readStateSnapshot();
  return summarizeFeedbackItems(items, snapshot.state);
}

export async function clearAllFeedback(): Promise<number> {
  const result = await getD1().prepare("DELETE FROM feedback_submissions").run();
  return result.meta?.changes ?? 0;
}

export async function listFeedback(user: AuthenticatedUser): Promise<FeedbackItem[]> {
  const statement = user.role === "super_admin" || user.role === "admin"
    ? getD1().prepare(
        `${FEEDBACK_SELECT} ORDER BY submitted_at DESC LIMIT 500`,
      )
    : getD1().prepare(
        `${FEEDBACK_SELECT} WHERE status IN ('reviewed', 'appeal_accepted') OR submitted_by = ? ORDER BY submitted_at DESC LIMIT 500`,
      ).bind(user.username);
  const result = await statement.all<FeedbackRow>();
  return (result.results || []).map(feedbackItemFromRow);
}

export async function submitFeedback(options: {
  type: FeedbackType;
  body: string;
  submittedBy: string;
  subjectPersonId?: string | null;
  subjectGroup?: "staff" | "worker" | null;
}): Promise<FeedbackItem> {
  const item: FeedbackItem = {
    id: crypto.randomUUID(),
    type: options.type,
    body: options.body.trim(),
    status: "pending",
    submittedBy: options.submittedBy,
    submittedAt: new Date().toISOString(),
    moderatedBy: null,
    moderatedAt: null,
    actionComment: null,
    appealDecisions: [],
    subjectPersonId: options.subjectPersonId || null,
    subjectGroup: options.subjectGroup || null,
  };
  await getD1()
    .prepare(
      "INSERT INTO feedback_submissions (id, type, body, status, submitted_by, submitted_at, moderated_by, moderated_at, subject_person_id, subject_group) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?)",
    )
    .bind(item.id, item.type, item.body, item.submittedBy, item.submittedAt, item.subjectPersonId, item.subjectGroup)
    .run();
  return item;
}

export async function moderateFeedback(options: {
  id: string;
  status: "reviewed" | "appeal_accepted" | "rejected";
  moderatedBy: string;
  actionComment?: string | null;
}): Promise<{ ok: true; item: FeedbackItem } | { ok: false; error: string }> {
  const existing = await getD1()
    .prepare("SELECT type, status, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions WHERE id = ?")
    .bind(options.id)
    .first<{ type: FeedbackType; status: FeedbackStatus; subjectPersonId: string | null; subjectGroup: "staff" | "worker" | null }>();
  if (!existing || existing.status !== "pending") {
    return { ok: false, error: "This submission was already handled or no longer exists." };
  }
  if (options.status === "appeal_accepted" && existing.type !== "appeal") {
    return { ok: false, error: "Only an appeal can receive Appeal Accepted status." };
  }
  if (options.status === "appeal_accepted") {
    return { ok: false, error: "Accepted appeals must reverse at least one active offence." };
  }
  if (options.status === "rejected" && existing.type !== "appeal") {
    return { ok: false, error: "Only an appeal can be rejected." };
  }
  if (options.status === "rejected") {
    const actionCommentError = validateAppealActionComment(options.actionComment);
    if (actionCommentError) return { ok: false, error: actionCommentError };
  }
  if (options.status === "reviewed" && existing.type === "appeal") {
    return { ok: false, error: "An appeal must be accepted or rejected." };
  }
  let appealDecisions: AppealIncidentDecision[] = [];
  if (options.status === "rejected" && existing.subjectPersonId && existing.subjectGroup) {
    const snapshot = await readStateSnapshot();
    const records = snapshot.state[existing.subjectGroup === "staff" ? "staffs" : "workers"];
    const person = Array.isArray(records)
      ? records.find((record) => !!record && typeof record === "object" && record.id === existing.subjectPersonId)
      : null;
    appealDecisions = appealDecisionsForOffences(person);
  }
  const moderatedAt = new Date().toISOString();
  const result = await getD1()
    .prepare(
      "UPDATE feedback_submissions SET status = ?, moderated_by = ?, moderated_at = ?, action_comment = ?, appeal_decisions = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(options.status, options.moderatedBy, moderatedAt, options.actionComment?.trim() || null, appealDecisions.length ? JSON.stringify(appealDecisions) : null, options.id)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: "This submission was already handled or no longer exists." };
  }
  const item = await getD1()
    .prepare(`${FEEDBACK_SELECT} WHERE id = ?`)
    .bind(options.id)
    .first<FeedbackRow>();
  if (!item) return { ok: false, error: "The moderated submission could not be reloaded." };
  return { ok: true, item: feedbackItemFromRow(item) };
}

export async function acceptAppealWithReversal(options: {
  id: string;
  subjectPersonId: string;
  subjectGroup: "staff" | "worker";
  incidentIds: string[];
  moderatedBy: string;
  actionComment: string;
  reconsiderRejected?: boolean;
}): Promise<
  | { ok: true; item: FeedbackItem; revision: number; reversedCount: number; reversedPoints: number; rejectedCount: number }
  | { ok: false; error: string }
> {
  const actionCommentError = validateAppealActionComment(options.actionComment);
  if (actionCommentError) return { ok: false, error: actionCommentError };
  const database = getD1();
  const expectedStatus: FeedbackStatus = options.reconsiderRejected ? "rejected" : "pending";
  const existing = await database
    .prepare("SELECT type, status, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions WHERE id = ?")
    .bind(options.id)
    .first<{ type: FeedbackType; status: FeedbackStatus; subjectPersonId: string | null; subjectGroup: "staff" | "worker" | null }>();
  if (!existing || existing.status !== expectedStatus) {
    return {
      ok: false,
      error: options.reconsiderRejected
        ? "Only a rejected appeal can be changed to accepted."
        : "This appeal was already handled or no longer exists.",
    };
  }
  if (existing.type !== "appeal") {
    return { ok: false, error: "Only an appeal can receive Appeal Accepted status." };
  }
  if (
    (existing.subjectPersonId && existing.subjectPersonId !== options.subjectPersonId) ||
    (existing.subjectGroup && existing.subjectGroup !== options.subjectGroup)
  ) {
    return { ok: false, error: "An appeal can reverse offences only for the personnel record it concerns." };
  }

  const snapshot = await readStateSnapshot();
  let reversal: ReturnType<typeof reverseAppealedIncidents>;
  try {
    reversal = reverseAppealedIncidents(snapshot.state, {
      subjectPersonId: options.subjectPersonId,
      subjectGroup: options.subjectGroup,
      incidentIds: options.incidentIds,
      actor: options.moderatedBy,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The selected offences could not be reversed." };
  }
  const validationErrors = validateStateGroups(reversal.state, [reversal.groupKey, "meta"]);
  if (validationErrors.length) return { ok: false, error: validationErrors[0] };

  const nextRevision = snapshot.revision + 1;
  const updatedAt = reversal.resolvedAt;
  const appealDecisions = appealDecisionsForOffences(reversal.previousPerson, options.incidentIds);
  // D1 batches are transactional. The guards deliberately raise a SQLite JSON
  // error if either compare-and-swap update changes no row, rolling back both.
  const guardedChange = database.prepare(
    "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('appeal transaction conflict') END AS verified",
  );
  try {
    await database.batch([
      database.prepare(
        "UPDATE application_snapshot SET value = ?, revision = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?",
      ).bind(JSON.stringify(reversal.state), nextRevision, updatedAt, options.moderatedBy, snapshot.revision),
      guardedChange,
      database.prepare(
        "UPDATE feedback_submissions SET status = 'appeal_accepted', moderated_by = ?, moderated_at = ?, action_comment = ?, appeal_decisions = ?, subject_person_id = ?, subject_group = ? WHERE id = ? AND status = ? AND type = 'appeal'",
      ).bind(options.moderatedBy, updatedAt, options.actionComment.trim(), JSON.stringify(appealDecisions), options.subjectPersonId, options.subjectGroup, options.id, expectedStatus),
      guardedChange,
      database.prepare(
        "INSERT INTO audit_events (id, category, entity_id, action, before_value, after_value, actor, revision, created_at) VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(), reversal.groupKey, options.subjectPersonId,
        JSON.stringify(reversal.previousPerson), JSON.stringify(reversal.person),
        options.moderatedBy, nextRevision, updatedAt,
      ),
    ]);
  } catch (error) {
    const current = await readStateSnapshot();
    if (current.revision !== snapshot.revision) {
      return { ok: false, error: "The personnel record changed on another device. Refresh and review this appeal again." };
    }
    const latest = await database.prepare("SELECT status FROM feedback_submissions WHERE id = ?")
      .bind(options.id).first<{ status: FeedbackStatus }>();
    if (!latest || latest.status !== expectedStatus) {
      return {
        ok: false,
        error: options.reconsiderRejected
          ? "This rejected appeal was already changed or no longer exists."
          : "This appeal was already handled or no longer exists.",
      };
    }
    throw error;
  }

  const item = await database.prepare(`${FEEDBACK_SELECT} WHERE id = ?`).bind(options.id).first<FeedbackRow>();
  if (!item) throw new Error("The approved appeal could not be reloaded.");
  return {
    ok: true,
    item: feedbackItemFromRow(item),
    revision: nextRevision,
    reversedCount: reversal.reversedCount,
    reversedPoints: reversal.reversedPoints,
    rejectedCount: appealDecisions.filter((decision) => decision.outcome === "rejected").length,
  };
}

export async function rejectAcceptedAppealWithRestoration(options: {
  id: string;
  moderatedBy: string;
  actionComment: string;
}): Promise<
  | { ok: true; item: FeedbackItem; revision: number; restoredCount: number; restoredPoints: number }
  | { ok: false; error: string }
> {
  const actionCommentError = validateAppealActionComment(options.actionComment);
  if (actionCommentError) return { ok: false, error: actionCommentError };
  const database = getD1();
  const existing = await database.prepare(
    "SELECT type, status, moderated_by AS moderatedBy, moderated_at AS moderatedAt, appeal_decisions AS appealDecisions, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions WHERE id = ?",
  ).bind(options.id).first<{
    type: FeedbackType;
    status: FeedbackStatus;
    moderatedBy: string | null;
    moderatedAt: string | null;
    appealDecisions: string | null;
    subjectPersonId: string | null;
    subjectGroup: "staff" | "worker" | null;
  }>();
  if (!existing || existing.type !== "appeal" || existing.status !== "appeal_accepted") {
    return { ok: false, error: "Only an accepted appeal can be changed to rejected." };
  }
  if (!existing.subjectPersonId || !existing.subjectGroup) {
    return { ok: false, error: "The accepted appeal is not linked to a personnel record." };
  }

  const snapshot = await readStateSnapshot();
  let restoration: ReturnType<typeof restoreAppealedIncidents>;
  try {
    restoration = restoreAppealedIncidents(snapshot.state, {
      subjectPersonId: existing.subjectPersonId,
      subjectGroup: existing.subjectGroup,
      acceptedAt: existing.moderatedAt,
      acceptedBy: existing.moderatedBy,
      actor: options.moderatedBy,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The appealed offences could not be restored." };
  }
  const validationErrors = validateStateGroups(restoration.state, [restoration.groupKey, "meta"]);
  if (validationErrors.length) return { ok: false, error: validationErrors[0] };

  const nextRevision = snapshot.revision + 1;
  const updatedAt = restoration.resolvedAt;
  const existingDecisions = parseAppealDecisions(existing.appealDecisions);
  const rejectedDecisions = existingDecisions.length
    ? existingDecisions.map((decision) => ({ ...decision, outcome: "rejected" as const }))
    : appealDecisionsForOffences(restoration.person);
  const guardedChange = database.prepare(
    "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('appeal restoration transaction conflict') END AS verified",
  );
  try {
    await database.batch([
      database.prepare(
        "UPDATE application_snapshot SET value = ?, revision = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?",
      ).bind(JSON.stringify(restoration.state), nextRevision, updatedAt, options.moderatedBy, snapshot.revision),
      guardedChange,
      database.prepare(
        "UPDATE feedback_submissions SET status = 'rejected', moderated_by = ?, moderated_at = ?, action_comment = ?, appeal_decisions = ? WHERE id = ? AND status = 'appeal_accepted' AND type = 'appeal'",
      ).bind(options.moderatedBy, updatedAt, options.actionComment.trim(), JSON.stringify(rejectedDecisions), options.id),
      guardedChange,
      database.prepare(
        "INSERT INTO audit_events (id, category, entity_id, action, before_value, after_value, actor, revision, created_at) VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(), restoration.groupKey, existing.subjectPersonId,
        JSON.stringify(restoration.previousPerson), JSON.stringify(restoration.person),
        options.moderatedBy, nextRevision, updatedAt,
      ),
    ]);
  } catch (error) {
    const current = await readStateSnapshot();
    if (current.revision !== snapshot.revision) {
      return { ok: false, error: "The personnel record changed on another device. Refresh and review this appeal again." };
    }
    const latest = await database.prepare("SELECT status FROM feedback_submissions WHERE id = ?")
      .bind(options.id).first<{ status: FeedbackStatus }>();
    if (!latest || latest.status !== "appeal_accepted") {
      return { ok: false, error: "This appeal was already changed or no longer exists." };
    }
    throw error;
  }

  const item = await database.prepare(`${FEEDBACK_SELECT} WHERE id = ?`).bind(options.id).first<FeedbackRow>();
  if (!item) throw new Error("The rejected appeal could not be reloaded.");
  return {
    ok: true,
    item: feedbackItemFromRow(item),
    revision: nextRevision,
    restoredCount: restoration.restoredCount,
    restoredPoints: restoration.restoredPoints,
  };
}
