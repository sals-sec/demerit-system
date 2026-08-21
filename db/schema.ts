import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const applicationState = sqliteTable("application_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const userAccounts = sqliteTable("user_accounts", {
  username: text("username").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  passwordAlgorithm: text("password_algorithm").notNull().default("pbkdf2-sha256"),
  passwordIterations: integer("password_iterations").notNull().default(310000),
  credentialVersion: text("credential_version").notNull().default("1"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
});

export const userSessions = sqliteTable("user_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  username: text("username").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const applicationSnapshot = sqliteTable("application_snapshot", {
  id: integer("id").primaryKey(),
  value: text("value").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  actor: text("actor").notNull(),
  revision: integer("revision").notNull(),
  createdAt: text("created_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  keyHash: text("key_hash").primaryKey(),
  failureCount: integer("failure_count").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  lockedUntil: integer("locked_until").notNull(),
});

export const feedbackSubmissions = sqliteTable("feedback_submissions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: text("submitted_at").notNull(),
  moderatedBy: text("moderated_by"),
  moderatedAt: text("moderated_at"),
  subjectPersonId: text("subject_person_id"),
  subjectGroup: text("subject_group"),
});
