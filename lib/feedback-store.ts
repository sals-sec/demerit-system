import { getD1 } from "../db";
import type { AuthenticatedUser } from "./security";

export const FEEDBACK_TYPES = ["comment", "review", "suggestion", "appeal"] as const;
export const FEEDBACK_STATUSES = ["pending", "reviewed", "appeal_accepted", "rejected"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackItem = {
  id: string;
  type: FeedbackType;
  body: string;
  status: FeedbackStatus;
  submittedBy: string;
  submittedAt: string;
  moderatedBy: string | null;
  moderatedAt: string | null;
  subjectPersonId: string | null;
  subjectGroup: "staff" | "worker" | null;
};

type FeedbackSummary = { pending: number; reviewed: number; appealAccepted: number; rejected: number };

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

export async function feedbackSummary(): Promise<FeedbackSummary> {
  const result = await getD1()
    .prepare("SELECT status, COUNT(*) AS count FROM feedback_submissions GROUP BY status")
    .all<{ status: FeedbackStatus; count: number }>();
  const summary: FeedbackSummary = { pending: 0, reviewed: 0, appealAccepted: 0, rejected: 0 };
  for (const row of result.results || []) {
    if (row.status === "pending") summary.pending = Number(row.count) || 0;
    if (row.status === "reviewed") summary.reviewed = Number(row.count) || 0;
    if (row.status === "appeal_accepted") summary.appealAccepted = Number(row.count) || 0;
    if (row.status === "rejected") summary.rejected = Number(row.count) || 0;
  }
  return summary;
}

export async function clearAllFeedback(): Promise<number> {
  const result = await getD1().prepare("DELETE FROM feedback_submissions").run();
  return result.meta?.changes ?? 0;
}

export async function listFeedback(user: AuthenticatedUser): Promise<FeedbackItem[]> {
  const statement = user.role === "super_admin" || user.role === "admin"
    ? getD1().prepare(
        "SELECT id, type, body, status, submitted_by AS submittedBy, submitted_at AS submittedAt, moderated_by AS moderatedBy, moderated_at AS moderatedAt, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions ORDER BY submitted_at DESC LIMIT 500",
      )
    : getD1().prepare(
        "SELECT id, type, body, status, submitted_by AS submittedBy, submitted_at AS submittedAt, moderated_by AS moderatedBy, moderated_at AS moderatedAt, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions WHERE status IN ('reviewed', 'appeal_accepted') OR submitted_by = ? ORDER BY submitted_at DESC LIMIT 500",
      ).bind(user.username);
  const result = await statement.all<FeedbackItem>();
  return result.results || [];
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
}): Promise<{ ok: true; item: FeedbackItem } | { ok: false; error: string }> {
  const existing = await getD1()
    .prepare("SELECT type, status FROM feedback_submissions WHERE id = ?")
    .bind(options.id)
    .first<{ type: FeedbackType; status: FeedbackStatus }>();
  if (!existing || existing.status !== "pending") {
    return { ok: false, error: "This submission was already handled or no longer exists." };
  }
  if (options.status === "appeal_accepted" && existing.type !== "appeal") {
    return { ok: false, error: "Only an appeal can receive Appeal Accepted status." };
  }
  if (options.status === "rejected" && existing.type !== "appeal") {
    return { ok: false, error: "Only an appeal can be rejected." };
  }
  if (options.status === "reviewed" && existing.type === "appeal") {
    return { ok: false, error: "An appeal must be accepted or rejected." };
  }
  const moderatedAt = new Date().toISOString();
  const result = await getD1()
    .prepare(
      "UPDATE feedback_submissions SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(options.status, options.moderatedBy, moderatedAt, options.id)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: "This submission was already handled or no longer exists." };
  }
  const item = await getD1()
    .prepare(
      "SELECT id, type, body, status, submitted_by AS submittedBy, submitted_at AS submittedAt, moderated_by AS moderatedBy, moderated_at AS moderatedAt, subject_person_id AS subjectPersonId, subject_group AS subjectGroup FROM feedback_submissions WHERE id = ?",
    )
    .bind(options.id)
    .first<FeedbackItem>();
  if (!item) return { ok: false, error: "The moderated submission could not be reloaded." };
  return { ok: true, item };
}
