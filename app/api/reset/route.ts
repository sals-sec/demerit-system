import { clearAllFeedback } from "../../../lib/feedback-store";
import { getSessionUser, validOrigin } from "../../../lib/security";
import { resetDisciplinaryState } from "../../../lib/dashboard-reset.mjs";
import { readStateSnapshot, writeStateSnapshot } from "../../../lib/state-store";
import { validateState } from "../../../lib/state-validation.mjs";

export const dynamic = "force-dynamic";

function json(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(payload, { ...init, headers });
}

export async function POST(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (user.role !== "super_admin") {
      return json({ error: "Only the Super Admin can reset Dashboard records." }, { status: 403 });
    }
    const body = (await request.json()) as { confirmation?: unknown };
    if (body.confirmation !== "RESET") {
      return json({ error: "Type RESET to confirm this operation." }, { status: 400 });
    }

    const snapshot = await readStateSnapshot();
    const resetAt = new Date().toISOString();
    const reset = resetDisciplinaryState(snapshot.state, user.username, resetAt);
    const validationErrors = validateState(reset.state, { partial: false });
    if (validationErrors.length) {
      return json({ error: validationErrors[0], details: validationErrors }, { status: 500 });
    }

    const result = await writeStateSnapshot({
      expectedRevision: snapshot.revision,
      state: reset.state,
      previousState: snapshot.state,
      changedKeys: ["staffs", "workers", "meta"],
      actor: user.username,
    });
    if (!result.ok) {
      return json({ error: "The records changed while reset was running. Try again.", conflict: true }, { status: 409 });
    }

    const clearedFeedback = await clearAllFeedback();
    return json({
      ok: true,
      revision: result.revision,
      lastUpdated: result.updatedAt,
      clearedPersonnel: reset.clearedPersonnel,
      clearedIncidents: reset.clearedIncidents,
      clearedPoints: reset.clearedPoints,
      clearedFeedback,
    });
  } catch (error) {
    console.error("Unable to reset SALS Dashboard records", error);
    return json({ error: "Unable to reset Dashboard records." }, { status: 500 });
  }
}
