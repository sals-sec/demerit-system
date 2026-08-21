import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applicationSecurityHeaders, renderApplicationHtml } from "../lib/html-response.mjs";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders metadata, origin and CSP nonces", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const nonce = "test-nonce";
  const rendered = renderApplicationHtml(template, "https://records.example", nonce);
  const headers = applicationSecurityHeaders(nonce);

  assert.match(rendered, developmentPreviewMeta);
  assert.doesNotMatch(rendered, /__SALS_SITE_ORIGIN__/);
  assert.match(rendered, /https:\/\/records\.example\/og\.png/);
  assert.equal((rendered.match(/nonce="test-nonce"/g) || []).length, 3);
  assert.match(headers["content-security-policy"], /nonce-test-nonce/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.equal(headers["x-content-type-options"], "nosniff");
});

test("offers an audited per-person offence-history reset", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /id="btn-clear-offence-history"/);
  assert.match(template, /p\.offenceLog = \[\];/);
  assert.match(template, /recalcPointsFromLog\(p, group\)/);
  assert.match(template, /server audit trail/);
  assert.match(template, /queueSave\(isStaff\?'staffs':'workers'\)/);
});

test("the embedded application script parses and includes role workflows", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const scripts = [...template.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi)];

  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) new Function(source);
  assert.match(template, /data-tab="feedback"/);
  assert.match(template, /data-tab="users"/);
  assert.match(template, /Pending after submission/);
  assert.match(template, /data-moderate-status="reviewed"/);
  assert.match(template, /data-moderate-status="appeal_accepted"/);
  assert.match(template, /data-moderate-status="rejected">Reject/);
  assert.match(template, /Rejected personnel appeals/);
  assert.doesNotMatch(template, /id="btn-record-person-incident"/);
  assert.match(template, /Comment \/ Appeal/);
  assert.match(template, /Personnel comments & appeals/);
  assert.match(template, /data-delete-account=/);
  assert.match(template, /method:'DELETE'/);
  assert.match(template, /id="btn-reset-dashboard"/);
  assert.match(template, /fetch\('\/api\/reset'/);
  assert.match(template, /Type RESET to continue/);
  assert.match(template, /subjectPersonId:id,subjectGroup:group/);
  assert.doesNotMatch(template, /openIncidentModal\(group, id\)/);
});
