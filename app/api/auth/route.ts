import {
  clearSession,
  clearLoginFailures,
  createSession,
  getSessionUser,
  loginRateLimit,
  isUserRole,
  recordLoginFailure,
  validOrigin,
  verifyCredentials,
} from "../../../lib/security";

export const dynamic = "force-dynamic";

function json(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser(request);
    return user ? json({ user }) : json({ error: "Sign in required." }, { status: 401 });
  } catch (error) {
    console.error("Unable to check the SALS session", error);
    return json({ error: "The account service is temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });

  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return json({ error: "Username and password are required." }, { status: 400 });
    }
    if (body.username.length > 320 || body.password.length > 1_024) {
      return json({ error: "Invalid username or password." }, { status: 400 });
    }

    const rateLimit = await loginRateLimit(request, body.username);
    if (!rateLimit.allowed) {
      return json(
        { error: "Too many sign-in attempts. Try again later." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfter) } },
      );
    }

    const user = await verifyCredentials(body.username, body.password);
    if (!user) {
      await recordLoginFailure(rateLimit.keyHash);
      return json({ error: "Incorrect username or password." }, { status: 401 });
    }
    if (!isUserRole(user.role)) {
      await recordLoginFailure(rateLimit.keyHash);
      return json({ error: "Incorrect username or password." }, { status: 401 });
    }

    await clearLoginFailures(rateLimit.keyHash);
    return json({ user }, { headers: { "set-cookie": await createSession(user) } });
  } catch (error) {
    console.error("Unable to sign in to SALS", error);
    return json({ error: "Sign-in is temporarily unavailable." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  return json({ ok: true }, { headers: { "set-cookie": await clearSession(request) } });
}
