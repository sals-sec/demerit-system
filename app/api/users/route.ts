import {
  createManagedAccount,
  deleteManagedAccount,
  getSessionUser,
  listManagedAccounts,
  updateManagedAccount,
  validOrigin,
} from "../../../lib/security";

export const dynamic = "force-dynamic";

function json(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(payload, { ...init, headers });
}

function roleCreatedBy(role: string): "admin" | "standard_user" | null {
  return role === "super_admin" ? "admin" : role === "admin" ? "standard_user" : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    const canCreateRole = roleCreatedBy(user.role);
    if (!canCreateRole) return json({ error: "Account management access is required." }, { status: 403 });
    return json({ accounts: await listManagedAccounts(user.role), canCreateRole });
  } catch (error) {
    console.error("Unable to list SALS accounts", error);
    return json({ error: "Unable to load user accounts." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    const role = roleCreatedBy(user.role);
    if (!role) return json({ error: "Account creation access is required." }, { status: 403 });
    const body = (await request.json()) as { username?: unknown; password?: unknown; name?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string" || typeof body.name !== "string") {
      return json({ error: "Username, password, and display name are required." }, { status: 400 });
    }
    const result = await createManagedAccount({
      username: body.username,
      password: body.password,
      name: body.name,
      role,
      createdBy: user.username,
    });
    if (!result.ok) return json({ error: result.error }, { status: result.error.includes("already exists") ? 409 : 400 });
    return json({ account: result.account }, { status: 201 });
  } catch (error) {
    console.error("Unable to create a SALS account", error);
    return json({ error: "Unable to create the user account." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (user.role !== "super_admin") {
      return json({ error: "Only Super Admin can edit user accounts." }, { status: 403 });
    }
    const body = (await request.json()) as {
      currentUsername?: unknown;
      username?: unknown;
      name?: unknown;
      password?: unknown;
    };
    if (
      typeof body.currentUsername !== "string" ||
      typeof body.username !== "string" ||
      typeof body.name !== "string" ||
      (body.password !== undefined && typeof body.password !== "string")
    ) {
      return json({ error: "Current username, new username, and display name are required." }, { status: 400 });
    }
    const result = await updateManagedAccount({
      currentUsername: body.currentUsername,
      username: body.username,
      name: body.name,
      password: typeof body.password === "string" ? body.password : undefined,
      requestedBy: user,
    });
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ account: result.account, credentialsChanged: result.credentialsChanged });
  } catch (error) {
    console.error("Unable to edit a SALS account", error);
    return json({ error: "Unable to edit the user account." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!validOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in required." }, { status: 401 });
    if (user.role !== "super_admin" && user.role !== "admin") {
      return json({ error: "Account deletion access is required." }, { status: 403 });
    }
    const body = (await request.json()) as { username?: unknown };
    if (typeof body.username !== "string" || body.username.length > 64) {
      return json({ error: "A valid account username is required." }, { status: 400 });
    }
    const result = await deleteManagedAccount({ username: body.username, requestedBy: user });
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ deleted: result.account });
  } catch (error) {
    console.error("Unable to delete a SALS account", error);
    return json({ error: "Unable to delete the user account." }, { status: 500 });
  }
}
