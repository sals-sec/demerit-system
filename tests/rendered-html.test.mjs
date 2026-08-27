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
  assert.match(rendered, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.equal((rendered.match(/nonce="test-nonce"/g) || []).length, 3);
  assert.match(headers["content-security-policy"], /nonce-test-nonce/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.equal(headers["x-content-type-options"], "nosniff");
});

test("login screen only offers SALS account sign in", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const login = template.match(/function renderLogin\(errorMsg\)\{[\s\S]*?\n\}/);

  assert.ok(login, "expected the login renderer");
  assert.match(login[0], /id="login-user"/);
  assert.match(login[0], /id="login-pass"/);
  assert.match(login[0], /<span>Sign in<\/span>/);
  assert.doesNotMatch(template, /Sign in with ChatGPT|\/signin-with-chatgpt|login-divider|login-visitor/);
});

test("offers an audited per-person offence-history reset", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /id="btn-clear-offence-history"/);
  assert.match(template, /p\.offenceLog = \[\];/);
  assert.match(template, /recalcPointsFromLog\(p, group\)/);
  assert.match(template, /server audit trail/);
  assert.match(template, /queueSave\(isStaff\?'staffs':'workers'\)/);
});

test("exports all offence rules as Excel and UTF-8 CSV", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /id="btn-export-offences-excel"/);
  assert.match(template, /id="btn-export-offences-csv"/);
  assert.match(template, /id="btn-export-offences-excel-data"/);
  assert.match(template, /id="btn-export-offences-csv-data"/);
  assert.match(template, /function offenceRulesExportRows\(\)/);
  assert.match(template, /Severity:o\.severity,[\s\S]*?Offences:o\.offence,[\s\S]*?'Demerit Points':o\.points,[\s\S]*?'Reason\/Basis':o\.reason\|\|''/);
  assert.match(template, /exportOffenceRules\('xlsx'\)/);
  assert.match(template, /exportOffenceRules\('csv'\)/);
  assert.match(template, /XLSX\.writeFile\(workbook, `\$\{baseName\}\.xlsx`/);
  assert.match(template, /const csv = '\\uFEFF' \+ XLSX\.utils\.sheet_to_csv\(sheet\)/);
  assert.match(template, /link\.download = `\$\{baseName\}\.csv`/);
});

test("imports Excel and CSV offence rules into shared rules only", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /id="btn-import-offences"/);
  assert.match(template, /id="offence-rules-input" accept="\.xlsx,\.xls,\.xlsm,\.csv,text\/csv"/);
  assert.match(template, /id="btn-import-offences-data"/);
  assert.match(template, /id="offence-rules-input-data" accept="\.xlsx,\.xls,\.xlsm,\.csv,text\/csv"/);
  assert.match(template, /async function importOffenceRulesFile\(file\)/);
  assert.match(template, /XLSX\.read\(await file\.text\(\), \{type:'string'\}\)/);
  assert.match(template, /XLSX\.read\(await file\.arrayBuffer\(\), \{type:'array'\}\)/);
  assert.match(template, /confirm\(`Replace the current \$\{state\.offences\.length\} offence rules/);
  assert.match(template, /await persist\('offences'\)/);
  assert.match(template, /state\.offences = previousOffences;[\s\S]*?state\.meta = previousMeta;/);
  assert.match(template, /\$\{imported\.length\} rules are now synced online\./);
});

test("validates imported offence rules and preserves existing matching rule IDs", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const functions = template.match(
    /function offenceImportColumnName\(value\)\{[\s\S]*?\n\}\n\nfunction parseOffenceRulesRows\(rows, existingRules\)\{[\s\S]*?\n\}\n/,
  );

  assert.ok(functions, "expected standalone offence-rule import parser functions");
  let nextId = 0;
  const parseRows = new Function("uid", `${functions[0]}; return parseOffenceRulesRows;`)(
    (prefix) => `${prefix}${++nextId}`,
  );
  const existing = [
    { id: "OFR-EXISTING", offence: "Missing safety helmet", severity: "Low Offence", points: 3 },
  ];
  const rules = parseRows(
    [
      ["Imported company policies"],
      ["Category", "Description", "Points", "Reason / Basis"],
      ["Major", "  Missing safety helmet  ", 25, "PPE policy"],
      ["minor offense", "Blocked emergency exit", "10", "Fire safety"],
    ],
    existing,
  );

  assert.deepEqual(rules, [
    {
      id: "OFR-EXISTING",
      severity: "Major Offence",
      offence: "Missing safety helmet",
      points: 25,
      reason: "PPE policy",
    },
    {
      id: "OFR1",
      severity: "Minor Offence",
      offence: "Blocked emergency exit",
      points: 10,
      reason: "Fire safety",
    },
  ]);
  assert.equal(parseRows([["Name", "Department"], ["Person", "Safety"]], existing), null);
  assert.throws(
    () => parseRows([["Offences", "Demerit Points"], ["Invalid rule", 0]], existing),
    /Row 2: demerit points must be a number from 1 to 100/,
  );
  assert.throws(
    () => parseRows([["Offences", "Demerit Points"], ["Repeated", 5], ["repeated", 8]], existing),
    /Row 3: "repeated" appears more than once/,
  );
});

test("queues every edited record group and serializes shared-state saves", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /const pendingSaveKeys = new Set\(\)/);
  assert.match(template, /pendingSaveKeys\.add\(key\)/);
  assert.match(template, /const keys=\[\.\.\.pendingSaveKeys\]/);
  assert.match(template, /const saved=await persist\(keys\)/);
  assert.match(template, /const task=saveChain\.then\(\(\)=>performSave\(keys\),\(\)=>performSave\(keys\)\)/);
  assert.match(template, /lastSyncedState\[key\]=sharedClone\(savedGroups\[key\]\)/);
  assert.match(template, /const rebaseKeys=\[\.\.\.new Set\(\[\.\.\.keys,\.\.\.pendingSaveKeys\]\)\]/);
  assert.match(template, /const hasUnsavedChanges=saveConflict\|\|pendingSaveKeys\.size>0/);
  assert.match(template, /Some changes have not been saved yet\. Refreshing now will discard them\./);
  assert.doesNotMatch(template, /setTimeout\(\(\)=>\{ saveTimer = null; persist\(key\); \}, 260\)/);
});

test("three-way merge keeps edits to different records and flags same-record conflicts", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const functions = template.match(
    /function sharedClone\(value\)\{[\s\S]*?\n\}\n\nfunction sameSharedValue\(left,right\)\{[\s\S]*?\n\nfunction sharedRecordKey\(record\)\{[\s\S]*?\n\}\n\nfunction threeWayMergeRecordGroup\(base,local,remote\)\{[\s\S]*?\n\}\n\nfunction captureSharedState/,
  );

  assert.ok(functions, "expected standalone shared-record merge helpers");
  const source = functions[0].replace(/\n\nfunction captureSharedState$/, "");
  const merge = new Function(`${source}; return threeWayMergeRecordGroup;`)();
  const base = [
    { id: "A", name: "Alpha", points: 0 },
    { id: "B", name: "Beta", points: 0 },
  ];
  const local = [
    { id: "A", name: "Alpha locally edited", points: 0 },
    { id: "B", name: "Beta", points: 0 },
  ];
  const remote = [
    { id: "A", name: "Alpha", points: 0 },
    { id: "B", name: "Beta", points: 12 },
  ];

  assert.deepEqual(merge(base, local, remote), [
    { id: "A", name: "Alpha locally edited", points: 0 },
    { id: "B", name: "Beta", points: 12 },
  ]);
  assert.equal(merge(base, [{ ...base[0], points: 5 }, base[1]], [{ ...base[0], points: 10 }, base[1]]), null);
  assert.deepEqual(
    merge([{ band: "0-10", action: "Observe" }], [{ band: "0-10", action: "Warn" }], [{ band: "0-10", action: "Observe" }]),
    [{ band: "0-10", action: "Warn" }],
  );
});

test("accepted appeals require incident selection from every moderation entry point", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /function openAppealResolutionModal\(appealId, reopenPerson\)/);
  assert.match(template, /id="appeal-confirm" disabled/);
  assert.match(template, /data-appeal-incident/);
  assert.match(template, /subjectPersonId:found\.p\.id,subjectGroup:found\.group,incidentIds/);
  assert.match(template, /await refreshSharedState\(true,true\)/);
  assert.equal((template.match(/moderateSubmission\(button/g)||[]).length, 4);
});

test("accepted and rejected appeals collect and display administrator action comments", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /function openAppealRejectionModal\(appealId, reopenPerson\)/);
  assert.match(template, /id="appeal-reject-comment" maxlength="2000"/);
  assert.match(template, /id="appeal-action-comment" maxlength="2000"/);
  assert.match(template, /status:'rejected',actionComment/);
  assert.match(template, /incidentIds,actionComment:comment/);
  assert.match(template, /actionComment\.value\.trim\(\)\.length<5/);
  assert.match(template, /item\.actionComment\?`<div class="feedback-decision/);
  assert.match(template, /Action taken · \$\{esc\(item\.moderatedBy\|\|'Administrator'\)\}/);
});

test("administrators can change accepted appeals to rejected and restore reversed points", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /item\.status==='pending' \|\| item\.status==='appeal_accepted'/);
  assert.match(template, /const wasAccepted=appeal\.status==='appeal_accepted'/);
  assert.match(template, /Change accepted appeal to rejected/);
  assert.match(template, /Reject & restore points/);
  assert.match(template, /status:'rejected',actionComment,reconsiderAccepted:wasAccepted/);
  assert.match(template, /if\(wasAccepted\) await refreshSharedState\(true,true\)/);
  assert.match(template, /isPersonnelAppeal&&item\.status==='appeal_accepted'/);
  assert.match(template, /data-moderate-status="rejected">Change to rejected/);
  assert.match(template, /moderated\.map\(item=>feedbackItemHtml\(item,isAdministrator\(\)\)\)/);
});

test("administrators can accept a previously rejected appeal and select offences again", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /item\.status==='pending' \|\| item\.status==='rejected'/);
  assert.match(template, /const wasRejected=appeal\.status==='rejected'/);
  assert.match(template, /Accept rejected appeal and reverse points/);
  assert.match(template, /Previous rejected decision/);
  assert.match(template, /Accept rejected appeal & reverse points/);
  assert.match(template, /incidentIds,actionComment:comment,reconsiderRejected:wasRejected/);
  assert.match(template, /isPersonnelAppeal&&item\.status==='rejected'/);
  assert.match(template, /data-moderate-status="appeal_accepted">Accept appeal/);
});

test("personnel comments and appeals display every offence and its individual points", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const match = template.match(/function offenceAppealOutcome\(item, offence\)\{[\s\S]*?\n\}\n\nfunction personnelOffenceDetailsHtml\(subject, item\)\{[\s\S]*?\n\}\n\nfunction feedbackItemHtml/);

  assert.ok(match, "expected a standalone personnel offence-detail renderer");
  const source = match[0].replace(/\n\nfunction feedbackItemHtml$/, "");
  const render = new Function("esc", `${source}; return personnelOffenceDetailsHtml;`)(
    (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  );
  const html = render({
    group: "worker",
    p: {
      name: "Worker <One>",
      employeeId: "W-123",
      demeritPoints: 10,
      action: "Final Verbal Reminder (On-the-Spot)",
      offenceLog: [
        { id: "incident-1", label: "Accepted safety appeal", points: 25, voided: true },
        { id: "incident-2", label: "Rejected active offence", points: 10, voided: false },
        { id: "incident-3", label: "Previously reversed offence", points: 15, voided: true },
      ],
    },
  }, {
    type: "appeal",
    status: "appeal_accepted",
    appealDecisions: [
      { incidentId: "incident-1", outcome: "appeal_accepted" },
      { incidentId: "incident-2", outcome: "rejected" },
    ],
  });

  assert.match(html, /Worker · Worker &lt;One&gt;/);
  assert.match(html, /W-123 · 1 active offence/);
  assert.match(html, /10 active pts/);
  assert.match(html, /Recommended Action/);
  assert.match(html, /Final Verbal Reminder \(On-the-Spot\)/);
  assert.match(html, /APPEAL ACCEPTED/);
  assert.match(html, /OF1\. Accepted safety appeal/);
  assert.match(html, /0 active · 25 pts original/);
  assert.match(html, /REJECTED/);
  assert.match(html, /OF2\. Rejected active offence/);
  assert.match(html, /\+10 pts/);
  assert.match(html, /VOIDED/);
  assert.match(html, /OF3\. Previously reversed offence/);
  assert.match(html, /0 active · 15 pts original/);
  assert.match(template, /personnelFeedback\.map\(item=>feedbackItemHtml\(item,isAdministrator\(\),true\)\)/);
});

test("personnel comments and appeals have their own desktop and mobile Overview page", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const dashboard = template.match(/function renderDashboard\(\)\{[\s\S]*?\n\}\n\n\/\* ============ PEOPLE TABLES/);

  assert.ok(dashboard, "expected the dashboard renderer to remain independently identifiable");
  assert.match(template, /data-tab="dashboard"[\s\S]*?data-tab="summary"[\s\S]*?data-tab="personnel-comments"[\s\S]*?<div class="nav-label">Records/);
  assert.match(template, /<option value="personnel-comments">Personnel Comments & Appeals<\/option>/);
  assert.match(template, /id="view-personnel-comments"/);
  assert.match(template, /else if\(tab==='personnel-comments'\) renderPersonnelComments\(\)/);
  assert.match(template, /if\(state\.tab==='personnel-comments'\) renderPersonnelComments\(\)/);
  assert.doesNotMatch(dashboard[0], /Personnel comments & appeals/);
});

test("all Dashboard section titles use consistent title capitalization", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const dashboard = template.match(/function renderDashboard\(\)\{[\s\S]*?\n\}\n\n\/\* ============ PEOPLE TABLES/);

  assert.ok(dashboard, "expected the dashboard renderer to remain independently identifiable");
  for (const title of [
    "Feedback Workflow",
    "Risk Distribution",
    "Personnel Mix",
    "Agency Workforce",
    "Data Integrity Checks",
    "Active Disciplinary Cases",
  ]) {
    assert.match(dashboard[0], new RegExp(`<h3>${title} <span`));
  }
  assert.doesNotMatch(dashboard[0], /<h3>(?:Feedback workflow|Risk distribution|Personnel mix|Agency workforce|Data integrity checks|Active disciplinary cases|Incident activity) /);
  assert.doesNotMatch(dashboard[0], /Incident Activity|No incident activity recorded|feed\.map/);
});

test("Personnel Comments & Appeals shows each linked person's recommended action responsively", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /<div class="feedback-recommended-action"><span>Recommended Action<\/span><b>\$\{esc\(person\.action\|\|'No Disciplinary Action'\)\}<\/b><\/div>/);
  assert.match(template, /\.feedback-recommended-action\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(template, /\.feedback-recommended-action\{grid-template-columns:1fr;gap:4px;\}/);
});

test("partial appeal outcomes display and count each offence independently", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /Every unselected active offence remains in force and is recorded as rejected/);
  assert.match(template, /\$\{selected\.length\} accepted · \$\{rejectedCount\} rejected/);
  assert.match(template, /appealDecisionSummaryHtml\(item\)/);
  assert.match(template, /offenceAppealBadge\(outcome\)/);
  assert.match(template, /<div class="hint">Accepted offences<\/div>/);
  assert.match(template, /<div class="hint">Rejected offences<\/div>/);
});

test("Agency Workforce shows full worker agency names and excludes SALS", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const dashboard = template.match(/function renderDashboard\(\)\{[\s\S]*?\n\}\n\n\/\* ============ PEOPLE TABLES/);

  assert.ok(dashboard, "expected the dashboard renderer");
  assert.match(dashboard[0], /state\.workers\.forEach\(p=>\{/);
  assert.match(dashboard[0], /if\(!a \|\| a\.toLowerCase\(\)==='sals'\) return;/);
  assert.match(dashboard[0], /<div class="agency-workforce-name">\$\{esc\(a\)\}<\/div>/);
  assert.doesNotMatch(dashboard[0], /a\.length>10|a\.slice\(0,9\)/);
  assert.match(template, /\.agency-workforce-name\{[^}]*overflow-wrap:anywhere;white-space:normal;/);
});

test("personnel comments page right-aligns the offence count and has no clear-display control", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const renderer = template.match(/function renderPersonnelComments\(\)\{[\s\S]*?\n\}\n\nasync function renderUsers/);

  assert.ok(renderer, "expected a dedicated personnel comments and appeals renderer");
  assert.match(renderer[0], /<h3>Personnel Comments & Appeals<\/h3>\s*<span class="tag">offence history and points/);
  assert.match(template, /\.personnel-feedback-toolbar \.tag\{margin-left:auto;text-align:right/);
  assert.doesNotMatch(renderer[0], /Clear display|Restore display|btn-clear-personnel-feedback|btn-restore-personnel-feedback/);
  assert.doesNotMatch(template, /sals-hidden-personnel-feedback/);
});

test("sidebar uses the supplied SALS logo above the live-system subtitle", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const shell = template.match(/function renderShell\(\)\{[\s\S]*?\n\}\nfunction setupSidebarSearch/);
  const logo = await readFile(new URL("../public/sals-logo.png", import.meta.url));

  assert.ok(shell, "expected the application shell renderer");
  assert.match(shell[0], /<div class="brand sidebar-brand">\s*<img class="sidebar-brand-logo" src="\/sals-logo\.png" alt="SALS logo">/);
  assert.match(shell[0], /<div class="t2">Demerit System · Live<\/div>/);
  assert.doesNotMatch(shell[0], /SALS DMS|brand-mark/);
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("phone sidebar has a back control that hides the navigation drawer", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const shell = template.match(/function renderShell\(\)\{[\s\S]*?\n\}\nfunction setupSidebarSearch/);

  assert.ok(shell, "expected the application shell renderer");
  assert.match(shell[0], /id="sidebar-mobile-close"[^>]*aria-label="Hide navigation menu"[^>]*title="Back"/);
  assert.match(shell[0], /closeSidebarBtn\.addEventListener\('click',[\s\S]*?classList\.remove\('open'\)/);
  assert.match(shell[0], /menuBtn\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(template, /\.btn\.sidebar-mobile-close\{display:none;/);
  assert.match(shell[0], /class="sidebar-brand-row"[\s\S]*?sidebar-brand-logo[\s\S]*?id="sidebar-mobile-close"/);
  assert.match(template, /@media \(max-width:720px\)\{\s*\.sidebar-brand-row\{display:flex;align-items:center;justify-content:space-between;gap:10px;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?\.btn\.sidebar-mobile-close\{display:inline-flex;align-self:center;\}/);
});

test("application theme combines SALS branding with blue action and graph accents", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /--bg:#0f0f0f;/);
  assert.match(template, /--panel:#171717;/);
  assert.match(template, /--text:#ffffff;/);
  assert.match(template, /--brand:#e8391a;/);
  assert.match(template, /--blue:#4c8dff;/);
  assert.match(template, /--blue-hover:#5b96ff;/);
  assert.match(template, /\.btn\.primary\{background:linear-gradient\(180deg,var\(--blue-hover\),var\(--blue\)\)/);
  assert.match(template, /\.sev-info\{background:linear-gradient\(90deg,var\(--blue-hover\),var\(--blue\)\);\}/);
  assert.match(template, /class="seg" style="width:\$\{staffPct\}%;background:var\(--blue\);"/);
});

test("requested feedback, account, and project-summary headings use every-word capitalization", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  for (const heading of [
    "Completed Complaints",
    "Complaint Review Queue",
    "Role Permission",
    "Managed Accounts",
    "Risk Intelligence",
    "People & Incident Records",
    "Policy Controls",
    "Controlled Access",
    "Shared Online Records",
    "Excel Continuity",
    "How The System Supports A Case",
  ]) assert.match(template, new RegExp(`<h3>${heading.replace(/[&]/g, "\\&")}(?: <span|<\\/h3>)`));

  assert.match(template, /<h3>Create \$\{targetLabel\} Account <span/);
  for (const step of [
    "Find The Person",
    "Record The Incident",
    "Calculate The Response",
    "Resolve & Report",
    "Access And Data Responsibility",
  ]) assert.match(template, new RegExp(`<b>${step.replace(/[&]/g, "\\&")}<\\/b>`));
});

test("only Super Admin can edit managed account identity and credentials", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const users = template.match(/function openEditUserAccount\(account\)\{[\s\S]*?\n\}\n\nasync function renderUsers\(\)\{[\s\S]*?\n\}\n\n\/\* ============ PROJECT SUMMARY/);

  assert.ok(users, "expected account edit and management renderers");
  assert.match(users[0], /if\(!isSuperAdmin\(\)\|\|!account\) return/);
  assert.match(users[0], /data-edit-account/);
  assert.match(users[0], /isSuperAdmin\(\)\?`<button class="btn sm" data-edit-account/);
  assert.match(users[0], /id="edit-user-name"/);
  assert.match(users[0], /id="edit-user-username"/);
  assert.match(users[0], /id="edit-user-password"/);
  assert.match(users[0], /id="edit-user-password-confirm"/);
  assert.match(users[0], /method:'PATCH'/);
  assert.match(users[0], /currentUsername:account\.username/);
  assert.match(users[0], /if\(password\) payload\.password=password/);
  assert.match(template, /\.account-actions\{display:flex;align-items:center;gap:8px;margin-left:auto;\}/);
  assert.match(template, /@media \(max-width:760px\)\{[\s\S]*?\.account-actions\{width:100%;justify-content:flex-end;\}/);
});

test("staff and worker record subtitles both use Demerit Ledger", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /staffs: \['Staff Records', 'Demerit Ledger'\]/);
  assert.match(template, /workers: \['Worker Records', 'Demerit Ledger'\]/);
  assert.doesNotMatch(template, /SALS Staff Demerit Ledger|Warehouse Workforce Demerit Ledger/);
});

test("Dashboard feedback workflow does not show the redundant review button", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.doesNotMatch(template, /data-open-feedback/);
  assert.doesNotMatch(template, /Review comments & appeals/);
  assert.match(template, /data-tab="feedback"/);
});

test("Feedback is a separate complaint channel without personnel appeals", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const renderer = template.match(/function renderFeedback\(\)\{[\s\S]*?\n\}\n\nfunction renderPersonnelComments/);

  assert.ok(renderer, "expected a dedicated complaint renderer");
  assert.match(renderer[0], /const complaints=state\.feedback\.filter\(item=>!item\.subjectPersonId\)/);
  assert.match(renderer[0], /<h3>Submit Complaint <span/);
  assert.match(renderer[0], /<h3>Complaint Review Queue <span/);
  assert.match(renderer[0], /<h3>Complaint History <span/);
  assert.match(renderer[0], /type:'comment',body/);
  assert.doesNotMatch(renderer[0], /feedback-type|personnelOffenceDetailsHtml|Completed Comments And Appeals/);
  assert.match(template, /const complaints=state\.feedback\.filter\(item=>!item\.subjectPersonId\);[\s\S]*?complaints\.filter\(item=>item\.status==='pending'\)/);
});

test("Personnel comments omit status summary cards and Dashboard omits Reviewed", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const personnel = template.match(/function renderPersonnelComments\(\)\{[\s\S]*?\n\}\n\nasync function renderUsers/);
  const cards = template.match(/function dashboardFeedbackStatusCards\(\)\{[\s\S]*?\n\}/);

  assert.ok(personnel, "expected the personnel comments renderer");
  assert.ok(cards, "expected Dashboard-only feedback cards");
  assert.doesNotMatch(personnel[0], /dashboardFeedbackStatusCards|feedback-grid|>Pending<|>Reviewed<|>Appeal Accepted<|>Rejected</);
  assert.match(cards[0], />Pending</);
  assert.match(cards[0], />Appeal Accepted</);
  assert.match(cards[0], />Rejected</);
  assert.doesNotMatch(cards[0], />Reviewed</);
  assert.match(template, /\.feedback-grid\{display:grid;grid-template-columns:repeat\(3,1fr\)/);
  assert.match(template, /@media \(max-width:760px\)\{\.feedback-grid\{grid-template-columns:1fr;\}\.feedback-recommended-action\{grid-template-columns:1fr;gap:4px;\}/);
});

test("Replace personnel imports preserve detailed and omitted incident histories by default", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const match = template.match(/function parsePeopleSheet\(rawRows, isStaff, existingArr, mode, hasDetailedIncidents\)\{[\s\S]*?\n\}\n\nfunction parseOffenceSheet/);
  assert.ok(match, "expected an independently testable personnel import parser");
  const source = match[0].replace(/\n\nfunction parseOffenceSheet$/, "");
  let nextId = 0;
  const parsePeople = new Function("uid", "clamp", "currentUser", `${source}; return parsePeopleSheet;`)(
    (prefix) => `${prefix}${++nextId}`,
    (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)),
    () => ({ username: "admin" }),
  );
  const existing = [
    {
      id: "worker-1", employeeId: "E-1", name: "Original name", demeritPoints: 20,
      offenceLog: [
        { id: "incident-1", label: "Documented incident", points: 20, voided: false, by: "security" },
        { id: "incident-2", label: "Successful prior appeal", points: 15, voided: true, by: "security" },
      ],
    },
    {
      id: "worker-2", employeeId: "E-2", name: "Omitted worker", demeritPoints: 5,
      offenceLog: [{ id: "incident-3", label: "Protected history", points: 5, voided: false }],
    },
    { id: "worker-3", employeeId: "E-3", name: "No incident history", offenceLog: [] },
  ];
  const imported = parsePeople(
    [{ "Employee ID": "e-1", Name: "Updated name", "Demerit Point": 0 }],
    false, existing, "replace", false,
  );

  assert.equal(imported.length, 2);
  assert.equal(imported[0].id, "worker-1");
  assert.equal(imported[0].demeritPoints, 20);
  assert.deepEqual(imported[0].offenceLog, existing[0].offenceLog);
  assert.notEqual(imported[0].offenceLog, existing[0].offenceLog);
  assert.equal(imported[1].id, "worker-2");
  const newOffence = parsePeople(
    [{ "Employee ID": "E-3", Name: "No incident history", OF1: 12 }],
    false, existing, "replace", false,
  );
  assert.equal(newOffence.find((person) => person.id === "worker-3").offenceLog[0].points, 12);
  assert.match(template, /Type REPLACE INCIDENTS to continue/);
  assert.match(template, /Incidents sheet is invalid: its Incident ID header is required/);
  assert.match(template, /json_to_sheet\(incidentRows,\{header:incidentHeaders\}\)/);
});

test("explicit incident replacement affects only workbook-targeted personnel groups", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const match = template.match(/function attachImportedIncidents\(incidentMap, mode, affectedGroups\)\{[\s\S]*?\n\}\n\nfunction parseThresholdSheet/);
  assert.ok(match, "expected an independently testable incident import helper");
  const source = match[0].replace(/\n\nfunction parseThresholdSheet$/, "");
  const state = {
    staffs: [{ id: "staff-1", employeeId: "S1", offenceLog: [{ id: "staff-history", points: 15 }] }],
    workers: [{ id: "worker-1", employeeId: "W1", offenceLog: [{ id: "worker-history", points: 20 }] }],
  };
  const attach = new Function("state", "recalcPointsFromLog", `${source}; return attachImportedIncidents;`)(
    state,
    (person) => {
      person.demeritPoints = person.offenceLog.reduce((sum, incident) => sum + Number(incident.points || 0), 0);
    },
  );

  attach(new Map(), "replace", new Set(["worker"]));
  assert.equal(state.staffs[0].offenceLog[0].id, "staff-history");
  assert.deepEqual(state.workers[0].offenceLog, []);
  assert.equal(state.workers[0].demeritPoints, 0);
});

test("all data tables support horizontal touch scrolling without hiding the first row", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  assert.match(template, /\.table-scroll\{[^}]*overflow-x:auto;[^}]*-webkit-overflow-scrolling:touch;[^}]*touch-action:pan-x pan-y;/);
  assert.match(template, /\.table-scroll thead th\{top:0;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?\.table-scroll-people>table\{min-width:920px;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?\.table-scroll-offences>table\{min-width:840px;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?\.table-scroll-thresholds>table\{min-width:720px;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?#view-thresholds \.grid-2\{grid-template-columns:minmax\(0,1fr\);\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?#view-thresholds \.grid-2>\.panel\{min-width:0;max-width:100%;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?#view-thresholds \.table-scroll-thresholds\{min-width:0;max-width:100%;\}/);
  assert.match(template, /@media \(max-width:720px\)\{[\s\S]*?\.table-scroll-cases>table\{min-width:840px;\}/);
  assert.match(template, /class="table-scroll table-scroll-people"[^>]*aria-label="\$\{isStaff\?'Staff':'Worker'\} records"/);
  assert.match(template, /class="table-scroll table-scroll-offences"[^>]*aria-label="Offence rules"/);
  assert.match(template, /class="table-scroll table-scroll-thresholds"[^>]*aria-label="\$\{esc\(label\)\} thresholds"/);
  assert.match(template, /class="table-scroll table-scroll-cases"[^>]*aria-label="Active Disciplinary Cases"/);
  assert.match(template, /Swipe left or right to see all columns/);
});

test("every page subtitle uses title case", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");

  const subtitles = [
    "People Risk & Disciplinary Overview — Live From Workbook",
    "Purpose, Capabilities, Workflow And Access Model",
    "Staff And Worker Responses, Offence Points, And Appeal Decisions",
    "Severity, Points And Rationale For Every Rule",
    "Point Bands Mapped To Required Action",
    "User Complaints And Administrative Review",
    "Role-Based Account Creation And Access",
    "Sync This System Directly From An Excel Workbook",
  ];

  for (const subtitle of subtitles) assert.match(template, new RegExp(subtitle));
  assert.doesNotMatch(template, /People risk & disciplinary overview/);
  assert.doesNotMatch(template, /Purpose, capabilities, workflow and access model/);
  assert.doesNotMatch(template, /Staff and worker responses, offence points, and appeal decisions/);
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
  assert.match(template, /Rejected offences/);
  assert.doesNotMatch(template, /id="btn-record-person-incident"/);
  assert.match(template, /<label>Appeal <span class="hint"/);
  assert.match(template, /Personnel Comments & Appeals/);
  assert.match(template, /data-delete-account=/);
  assert.match(template, /method:'DELETE'/);
  assert.match(template, /id="btn-reset-dashboard"/);
  assert.match(template, /fetch\('\/api\/reset'/);
  assert.match(template, /Type RESET to continue/);
  assert.match(template, /subjectPersonId:id,subjectGroup:group/);
  assert.doesNotMatch(template, /openIncidentModal\(group, id\)/);
  assert.match(template, /p\.employeeId = String\(p\.employeeId \?\? ''\)\.trim\(\)/);
  assert.match(template, /p\.passportNo = String\(p\.passportNo \?\? ''\)\.trim\(\)/);
  assert.match(template, /isSuperAdmin\(\) \? 'Super Admin'/);
});

test("record response form only submits appeals with a concise Submit button", async () => {
  const template = await readFile(new URL("../app/application.html", import.meta.url), "utf8");
  const modal = template.match(/function openPersonModal\(id, group\)\{[\s\S]*?\n\}\n\n\nfunction confirmDeletePerson/);

  assert.ok(modal, "expected the staff and worker record modal");
  assert.match(modal[0], /<label>Response Type<\/label><input data-feedback-input value="Appeal" readonly>/);
  assert.match(modal[0], /id="btn-submit-person-feedback">\$\{ICONS\.message\} Submit<\/button>/);
  assert.match(modal[0], /JSON\.stringify\(\{type:'appeal',body,subjectPersonId:id,subjectGroup:group\}\)/);
  assert.doesNotMatch(modal[0], /person-feedback-type|<option value="comment">Comment<\/option>|Submit response for review/);
});
