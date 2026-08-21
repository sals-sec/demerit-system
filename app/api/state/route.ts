import { getSessionUser, validOrigin } from "../../../lib/security";
import { readStateSnapshot, writeStateSnapshot } from "../../../lib/state-store";
import {
  mergeState,
  supportedStatePatch,
  validateState,
} from "../../../lib/state-validation.mjs";

export const dynamic = "force-dynamic";

const MAX_STATE_BODY_BYTES = 6 * 1024 * 1024;

function json(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(payload, { ...init, headers });
}

function accessFor(role: string): "admin" | "viewer" {
  const normalized = role.trim().toLowerCase();
  return normalized === "super_admin" || normalized === "admin" ? "admin" : "viewer";
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });

    const snapshot = await readStateSnapshot();
    const requestedRevision = Number(new URL(request.url).searchParams.get("revision"));
    if (Number.isSafeInteger(requestedRevision) && requestedRevision === snapshot.revision) {
      return json({
        unchanged: true,
        revision: snapshot.revision,
        lastUpdated: snapshot.updatedAt,
        user,
        access: accessFor(user.role),
      });
    }

    return json({
      state: snapshot.state,
      revision: snapshot.revision,
      lastUpdated: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
      user,
      access: accessFor(user.role),
    });
  } catch (error) {
    console.error("Unable to load SALS records", error);
    return json({ error: "Unable to load shared security records." }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });

  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (accessFor(user.role) !== "admin") {
      return json({ error: "Only administrators can update shared records." }, { status: 403 });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_STATE_BODY_BYTES) {
      return json({ error: "The state update is too large." }, { status: 413 });
    }

    const body = (await request.json()) as { state?: unknown; revision?: unknown };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (bodyBytes > MAX_STATE_BODY_BYTES) {
      return json({ error: "The state update is too large." }, { status: 413 });
    }
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) {
      return json({ error: "A valid state revision is required." }, { status: 400 });
    }

    const patch = supportedStatePatch(body.state);
    const validationErrors = validateState(body.state, { partial: true });
    if (!patch || validationErrors.length) {
      return json(
        { error: validationErrors[0] || "A state object is required.", details: validationErrors },
        { status: 400 },
      );
    }
    const changedKeys = Object.keys(patch);
    if (!changedKeys.length) {
      return json({ error: "No supported record groups were provided." }, { status: 400 });
    }

    const snapshot = await readStateSnapshot();
    if (snapshot.revision !== body.revision) {
      return json(
        {
          error: "The records changed on another device. Refresh before saving again.",
          conflict: true,
          revision: snapshot.revision,
          lastUpdated: snapshot.updatedAt,
        },
        { status: 409 },
      );
    }

    const nextState = mergeState(snapshot.state, patch);
    nextState.meta = {
      ...((nextState.meta && typeof nextState.meta === "object" && !Array.isArray(nextState.meta)
        ? nextState.meta
        : {}) as Record<string, unknown>),
      lastModifiedBy: user.username,
      lastUpdated: new Date().toISOString(),
    };
    const completeValidationErrors = validateState(nextState, {
      partial: !["offences", "staffs", "workers", "sdp", "wdp", "meta"].every(
        (key) => key in nextState,
      ),
    });
    if (completeValidationErrors.length) {
      return json(
        { error: completeValidationErrors[0], details: completeValidationErrors },
        { status: 400 },
      );
    }

    const result = await writeStateSnapshot({
      expectedRevision: Number(body.revision),
      state: nextState,
      previousState: snapshot.state,
      changedKeys,
      actor: user.username,
    });
    if (!result.ok) {
      return json(
        {
          error: "The records changed on another device. Refresh before saving again.",
          conflict: true,
          revision: result.current.revision,
          lastUpdated: result.current.updatedAt,
        },
        { status: 409 },
      );
    }

    return json({
      ok: true,
      revision: result.revision,
      lastUpdated: result.updatedAt,
      updatedBy: user.username,
    });
  } catch (error) {
    console.error("Unable to save SALS records", error);
    return json({ error: "Unable to save shared security records." }, { status: 500 });
  }
}
