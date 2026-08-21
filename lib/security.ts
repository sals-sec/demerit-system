import { env } from "cloudflare:workers";
import { getD1 } from "../db";

const COOKIE_NAME = "sals_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 12;
const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 310_000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 5;

export const USER_ROLES = ["super_admin", "admin", "standard_user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export type AuthenticatedUser = {
  username: string;
  name: string;
  role: UserRole;
  source: "workspace" | "password";
};

export type LoginRateLimit = {
  allowed: boolean;
  retryAfter: number;
  keyHash: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(hashed));
}

async function passwordDigest(password: string, salt: string, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function randomToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function commaSeparatedSet(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function workspaceUser(request: Request): AuthenticatedUser | null {
  if (env.SALS_TRUST_WORKSPACE_HEADERS !== "true") return null;
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const administrators = commaSeparatedSet(env.SALS_ADMIN_EMAILS);
  const authorized = commaSeparatedSet(env.SALS_AUTHORIZED_EMAILS);
  if (!administrators.has(email) && !authorized.has(email)) return null;
  const fullName =
    request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? safeDecode(request.headers.get("oai-authenticated-user-full-name"))
      : null;
  return {
    username: email,
    name: fullName || email,
    role: administrators.has(email) ? "super_admin" : "standard_user",
    source: "workspace",
  };
}

export async function ensureInitialized(): Promise<void> {
  const database = getD1();
  const now = Math.floor(Date.now() / 1000);
  await database.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now).run();

  const username = env.SALS_ADMIN_USERNAME?.trim().toLowerCase() || "";
  const password = env.SALS_ADMIN_PASSWORD || "";
  const configured = !!username && !!password;
  const existingCount = await database
    .prepare("SELECT COUNT(*) AS count FROM user_accounts")
    .first<{ count: number }>();

  if (!configured) {
    if ((existingCount?.count ?? 0) === 0) {
      throw new Error(
        "No administrator is configured. Set SALS_ADMIN_USERNAME and SALS_ADMIN_PASSWORD as deployment secrets.",
      );
    }
    return;
  }

  const credentialVersion = env.SALS_ADMIN_PASSWORD_VERSION?.trim() || "1";
  const existing = await database
    .prepare("SELECT username, credential_version, role FROM user_accounts WHERE username = ?")
    .bind(username)
    .first<{ username: string; credential_version: string; role: string }>();
  if (existing?.credential_version === credentialVersion && existing.role === "super_admin") return;

  const salt = randomToken();
  const passwordHash = await passwordDigest(password, salt, PASSWORD_ITERATIONS);
  const createdAt = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO user_accounts (username, password_hash, password_salt, name, role, password_algorithm, password_iterations, credential_version, created_at, created_by) VALUES (?, ?, ?, ?, 'super_admin', ?, ?, ?, ?, 'system') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, name = excluded.name, role = 'super_admin', password_algorithm = excluded.password_algorithm, password_iterations = excluded.password_iterations, credential_version = excluded.credential_version",
      )
      .bind(
        username,
        passwordHash,
        salt,
        env.SALS_ADMIN_NAME?.trim() || username,
        PASSWORD_ALGORITHM,
        PASSWORD_ITERATIONS,
        credentialVersion,
        createdAt,
      ),
    database.prepare("DELETE FROM user_sessions WHERE username = ?").bind(username),
  ]);
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  await ensureInitialized();
  const account = await getD1()
    .prepare(
      "SELECT username, password_hash, password_salt, password_algorithm, password_iterations, name, role FROM user_accounts WHERE username = ?",
    )
    .bind(username.trim().toLowerCase())
    .first<{
      username: string;
      password_hash: string;
      password_salt: string;
      password_algorithm: string;
      password_iterations: number;
      name: string;
      role: string;
    }>();

  const supportedAccount = account?.password_algorithm === PASSWORD_ALGORITHM ? account : null;
  const candidateHash = await passwordDigest(
    password,
    supportedAccount?.password_salt || "00000000000000000000000000000000",
    supportedAccount?.password_iterations || PASSWORD_ITERATIONS,
  );
  if (
    !supportedAccount ||
    !secureEqual(candidateHash, supportedAccount.password_hash) ||
    !isUserRole(supportedAccount.role)
  ) return null;
  return { username: supportedAccount.username, name: supportedAccount.name, role: supportedAccount.role, source: "password" };
}

export type ManagedAccount = {
  username: string;
  name: string;
  role: UserRole;
  createdAt: string;
  createdBy: string | null;
};

export async function listManagedAccounts(role: UserRole): Promise<ManagedAccount[]> {
  if (role !== "super_admin" && role !== "admin") return [];
  const statement = role === "super_admin"
    ? getD1().prepare(
        "SELECT username, name, role, created_at AS createdAt, created_by AS createdBy FROM user_accounts WHERE role IN ('admin', 'standard_user') ORDER BY created_at DESC, username ASC",
      )
    : getD1().prepare(
        "SELECT username, name, role, created_at AS createdAt, created_by AS createdBy FROM user_accounts WHERE role = 'standard_user' ORDER BY created_at DESC, username ASC",
      );
  const result = await statement.all<ManagedAccount>();
  return (result.results || []).filter((account) => isUserRole(account.role));
}

export async function createManagedAccount(options: {
  username: string;
  password: string;
  name: string;
  role: "admin" | "standard_user";
  createdBy: string;
}): Promise<{ ok: true; account: ManagedAccount } | { ok: false; error: string }> {
  const username = options.username.trim().toLowerCase();
  const name = options.name.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    return { ok: false, error: "Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens." };
  }
  if (!name || name.length > 120) return { ok: false, error: "A display name of up to 120 characters is required." };
  if (options.password.length < 8 || options.password.length > 1_024) {
    return { ok: false, error: "Password must be between 8 and 1,024 characters." };
  }
  const existing = await getD1()
    .prepare("SELECT username FROM user_accounts WHERE username = ?")
    .bind(username)
    .first<{ username: string }>();
  if (existing) return { ok: false, error: "That username already exists." };

  const salt = randomToken();
  const passwordHash = await passwordDigest(options.password, salt, PASSWORD_ITERATIONS);
  const createdAt = new Date().toISOString();
  await getD1()
    .prepare(
      "INSERT INTO user_accounts (username, password_hash, password_salt, name, role, password_algorithm, password_iterations, credential_version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, '1', ?, ?)",
    )
    .bind(
      username,
      passwordHash,
      salt,
      name,
      options.role,
      PASSWORD_ALGORITHM,
      PASSWORD_ITERATIONS,
      createdAt,
      options.createdBy,
    )
    .run();
  return {
    ok: true,
    account: { username, name, role: options.role, createdAt, createdBy: options.createdBy },
  };
}

export async function deleteManagedAccount(options: {
  username: string;
  requestedBy: AuthenticatedUser;
}): Promise<{ ok: true; account: ManagedAccount } | { ok: false; error: string; status: 400 | 403 | 404 }> {
  const username = options.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    return { ok: false, error: "A valid account username is required.", status: 400 };
  }
  if (username === options.requestedBy.username) {
    return { ok: false, error: "You cannot delete the account currently in use.", status: 403 };
  }

  const database = getD1();
  const account = await database
    .prepare(
      "SELECT username, name, role, created_at AS createdAt, created_by AS createdBy FROM user_accounts WHERE username = ?",
    )
    .bind(username)
    .first<ManagedAccount>();
  if (!account || !isUserRole(account.role)) {
    return { ok: false, error: "The selected account no longer exists.", status: 404 };
  }

  const allowed = options.requestedBy.role === "super_admin"
    ? account.role === "admin" || account.role === "standard_user"
    : options.requestedBy.role === "admin" && account.role === "standard_user";
  if (!allowed) {
    return { ok: false, error: "You do not have permission to delete this account.", status: 403 };
  }

  const results = await database.batch([
    database.prepare("DELETE FROM user_sessions WHERE username = ?").bind(username),
    database.prepare("DELETE FROM user_accounts WHERE username = ? AND role = ?").bind(username, account.role),
  ]);
  const accountDeletion = results[1] as { meta?: { changes?: number } } | undefined;
  if ((accountDeletion?.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: "The selected account no longer exists.", status: 404 };
  }
  return { ok: true, account };
}

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  for (const segment of cookie.split(";")) {
    const [name, ...value] = segment.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=") || null;
  }
  return null;
}

export async function getSessionUser(request: Request): Promise<AuthenticatedUser | null> {
  const trustedWorkspaceUser = workspaceUser(request);
  if (trustedWorkspaceUser) return trustedWorkspaceUser;
  const token = sessionToken(request);
  if (!token) return null;
  const account = await getD1()
    .prepare(
      "SELECT accounts.username, accounts.name, accounts.role FROM user_sessions AS sessions JOIN user_accounts AS accounts ON accounts.username = sessions.username WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
    )
    .bind(await digest(token), Math.floor(Date.now() / 1000))
    .first<Omit<AuthenticatedUser, "source">>();
  return account ? { ...account, source: "password" } : null;
}

export async function createSession(user: AuthenticatedUser): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await getD1()
    .prepare(
      "INSERT INTO user_sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(await digest(token), user.username, now + SESSION_LIFETIME_SECONDS, new Date().toISOString())
    .run();
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_LIFETIME_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export async function clearSession(request: Request): Promise<string> {
  const token = sessionToken(request);
  if (token) {
    await getD1()
      .prepare("DELETE FROM user_sessions WHERE token_hash = ?")
      .bind(await digest(token))
      .run();
  }
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function loginIdentity(request: Request, username: string): string {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  return `${address}:${username.trim().toLowerCase()}`;
}

export async function loginRateLimit(request: Request, username: string): Promise<LoginRateLimit> {
  const keyHash = await digest(loginIdentity(request, username));
  const now = Math.floor(Date.now() / 1000);
  const row = await getD1()
    .prepare("SELECT failure_count, window_started_at, locked_until FROM auth_attempts WHERE key_hash = ?")
    .bind(keyHash)
    .first<{ failure_count: number; window_started_at: number; locked_until: number }>();
  if (!row || now - row.window_started_at > LOGIN_WINDOW_SECONDS) {
    return { allowed: true, retryAfter: 0, keyHash };
  }
  if (row.locked_until > now) {
    return { allowed: false, retryAfter: row.locked_until - now, keyHash };
  }
  return { allowed: true, retryAfter: 0, keyHash };
}

export async function recordLoginFailure(keyHash: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const row = await getD1()
    .prepare("SELECT failure_count, window_started_at FROM auth_attempts WHERE key_hash = ?")
    .bind(keyHash)
    .first<{ failure_count: number; window_started_at: number }>();
  const withinWindow = !!row && now - row.window_started_at <= LOGIN_WINDOW_SECONDS;
  const failureCount = withinWindow ? row.failure_count + 1 : 1;
  const windowStartedAt = withinWindow ? row.window_started_at : now;
  const lockedUntil = failureCount >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCK_SECONDS : 0;
  await getD1()
    .prepare(
      "INSERT INTO auth_attempts (key_hash, failure_count, window_started_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(key_hash) DO UPDATE SET failure_count = excluded.failure_count, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until",
    )
    .bind(keyHash, failureCount, windowStartedAt, lockedUntil)
    .run();
}

export async function clearLoginFailures(keyHash: string): Promise<void> {
  await getD1().prepare("DELETE FROM auth_attempts WHERE key_hash = ?").bind(keyHash).run();
}

export function validOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}
