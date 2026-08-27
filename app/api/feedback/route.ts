import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  acceptAppealWithReversal,
  feedbackSummary,
  listFeedback,
  moderateFeedback,
  rejectAcceptedAppealWithRestoration,
  submitFeedback,
  validateAppealActionComment,
  validateFeedback,
} from "../../../lib/feedback-store";
import { getSessionUser, validOrigin } from "../../../lib/security";
import { readStateSnapshot } from "../../../lib/state-store";

export const dynamic = "force-dynamic";

function json(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    return json({ items: await listFeedback(user), summary: await feedbackSummary() });
  } catch (error) {
    console.error("Unable to list SALS feedback", error);
    return json({ error: "Unable to load feedback." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (user.role !== "standard_user") {
      return json({ error: "Only Standard Users can submit feedback." }, { status: 403 });
    }
    const body = (await request.json()) as {
      type?: unknown;
      body?: unknown;
      subjectPersonId?: unknown;
      subjectGroup?: unknown;
    };
    const validationError = validateFeedback(body.type, body.body);
    if (validationError) return json({ error: validationError }, { status: 400 });
    const hasSubject = body.subjectPersonId !== undefined || body.subjectGroup !== undefined;
    let subjectPersonId: string | null = null;
    let subjectGroup: "staff" | "worker" | null = null;
    if (hasSubject) {
      if (
        typeof body.subjectPersonId !== "string" ||
        !body.subjectPersonId.trim() ||
        body.subjectPersonId.length > 100 ||
        (body.subjectGroup !== "staff" && body.subjectGroup !== "worker")
      ) {
        return json({ error: "A valid staff or worker record is required for this response." }, { status: 400 });
      }
      subjectPersonId = body.subjectPersonId.trim();
      subjectGroup = body.subjectGroup;
      const snapshot = await readStateSnapshot();
      const records = snapshot.state[subjectGroup === "staff" ? "staffs" : "workers"];
      const exists = Array.isArray(records) && records.some((record) =>
        !!record && typeof record === "object" && (record as { id?: unknown }).id === subjectPersonId
      );
      if (!exists) return json({ error: "The selected personnel record no longer exists." }, { status: 404 });
    }
    const type = body.type as (typeof FEEDBACK_TYPES)[number];
    if (hasSubject && type !== "appeal") {
      return json({ error: "Personnel responses must be an appeal." }, { status: 400 });
    }
    return json({
      item: await submitFeedback({
        type,
        body: String(body.body),
        submittedBy: user.username,
        subjectPersonId,
        subjectGroup,
      }),
    }, { status: 201 });
  } catch (error) {
    console.error("Unable to submit SALS feedback", error);
    return json({ error: "Unable to submit feedback." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (user.role !== "super_admin" && user.role !== "admin") {
      return json({ error: "Admin or Super Admin access is required to review comments and appeals." }, { status: 403 });
    }
    const body = (await request.json()) as {
      id?: unknown;
      status?: unknown;
      subjectPersonId?: unknown;
      subjectGroup?: unknown;
      incidentIds?: unknown;
      actionComment?: unknown;
      reconsiderAccepted?: unknown;
      reconsiderRejected?: unknown;
    };
    if (typeof body.id !== "string" || body.id.length > 100 ||
        (body.status !== "reviewed" && body.status !== "appeal_accepted" && body.status !== "rejected") ||
        !FEEDBACK_STATUSES.includes(body.status)) {
      return json({ error: "A valid pending submission and moderation status are required." }, { status: 400 });
    }
    if (body.status === "appeal_accepted" || body.status === "rejected") {
      const actionCommentError = validateAppealActionComment(body.actionComment);
      if (actionCommentError) return json({ error: actionCommentError }, { status: 400 });
    }
    if (
      (body.reconsiderAccepted !== undefined && typeof body.reconsiderAccepted !== "boolean") ||
      (body.reconsiderRejected !== undefined && typeof body.reconsiderRejected !== "boolean")
    ) {
      return json({ error: "The appeal reconsideration request is invalid." }, { status: 400 });
    }
    if (body.status === "appeal_accepted") {
      if (
        typeof body.subjectPersonId !== "string" || !body.subjectPersonId.trim() || body.subjectPersonId.length > 100 ||
        (body.subjectGroup !== "staff" && body.subjectGroup !== "worker") ||
        !Array.isArray(body.incidentIds) || !body.incidentIds.length || body.incidentIds.length > 1_000 ||
        body.incidentIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)
      ) {
        return json({
          error: "Accepting an appeal requires a personnel record and at least one active offence to reverse.",
        }, { status: 400 });
      }
      const result = await acceptAppealWithReversal({
        id: body.id,
        subjectPersonId: body.subjectPersonId.trim(),
        subjectGroup: body.subjectGroup,
        incidentIds: body.incidentIds as string[],
        moderatedBy: user.username,
        actionComment: String(body.actionComment).trim(),
        reconsiderRejected: body.reconsiderRejected === true,
      });
      if (!result.ok) return json({ error: result.error }, { status: 409 });
      return json({
        item: result.item,
        revision: result.revision,
        reversedCount: result.reversedCount,
        reversedPoints: result.reversedPoints,
        rejectedCount: result.rejectedCount,
      });
    }
    if (body.status === "rejected" && body.reconsiderAccepted === true) {
      const result = await rejectAcceptedAppealWithRestoration({
        id: body.id,
        moderatedBy: user.username,
        actionComment: String(body.actionComment).trim(),
      });
      if (!result.ok) return json({ error: result.error }, { status: 409 });
      return json({
        item: result.item,
        revision: result.revision,
        restoredCount: result.restoredCount,
        restoredPoints: result.restoredPoints,
      });
    }
    const result = await moderateFeedback({
      id: body.id,
      status: body.status,
      moderatedBy: user.username,
      actionComment: typeof body.actionComment === "string" ? body.actionComment.trim() : null,
    });
    if (!result.ok) return json({ error: result.error }, { status: 409 });
    return json({ item: result.item });
  } catch (error) {
    console.error("Unable to moderate SALS feedback", error);
    return json({ error: "Unable to moderate feedback." }, { status: 500 });
  }
}
