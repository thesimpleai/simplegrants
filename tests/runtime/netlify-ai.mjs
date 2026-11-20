/** Runs the built UI and packaged Netlify bootstrap; no app handlers/SDKs are mocked.
 * The isolated HTTP fixture supplies Auth/PostgREST/Storage and, by default,
 * controlled Gemini responses. --live sends the seven model calls to Gemini.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as http from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { unzipSync } from "fflate";
import { zipFunctions } from "@netlify/zip-it-and-ship-it";
import { chromium, expect } from "@playwright/test";
import {
  orgId,
  actorId,
  grantId,
  appId,
  sourceText,
  org,
  grant,
  application,
  evidence,
  providerReply,
} from "./fixtures.mjs";
const run = promisify(execFile);
const live = process.argv.includes("--live");
const quick = process.argv.includes("--quick");
if (live && !process.env.GEMINI_API_KEY)
  throw Error(
    "Add GEMINI_API_KEY through environment secret settings before running --live.",
  );
const root = await mkdtemp(join(tmpdir(), "simplegrants-ai-runtime-"));
if (live && process.env.HTTPS_PROXY) {
  if (typeof http.setGlobalProxyFromEnv !== "function")
    throw Error(
      "Live checks through an environment proxy require Node 24.5 or later.",
    );
  http.setGlobalProxyFromEnv();
}
const originalFetch = globalThis.fetch;
const state = {
  orgs: [structuredClone(org)],
  grants: [structuredClone(grant)],
  applications: [structuredClone(application)],
  claims: 0,
  polls: 0,
  modelCalls: 0,
  payloads: [],
  workers: [],
  errors: [],
  providerFailure: 0,
  profileOutputLimit: false,
  delayed: false,
  orgWrites: 0,
};
const objects = new Map(
  evidence.map((doc) => [
    `simple-grant-documents/${doc.record.storage_path}`,
    {
      bytes: Buffer.from(doc.bytes),
      type: doc.mime_type,
      created_at: new Date().toISOString(),
    },
  ]),
);
const user = {
  id: actorId,
  email: "runtime@example.invalid",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-11-01T00:00:00Z",
};
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actorId, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture-signature`;
const tables = {
  organizations: state.orgs,
  opportunities: state.grants,
  applications: state.applications,
  documents: evidence.map((doc) => doc.record),
  organization_members: [{ org_id: orgId, user_id: actorId, role: "owner" }],
  funded_projects: [],
  expenses: [],
  inbox_messages: [],
};
const json = (response, body, status = 200) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let site, browser;
const handlers = new Map();
globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: {
    from: (stream, metadata) => {
      stream.metadata = metadata;
      return stream;
    },
  },
};
async function invoke(name, url, method, headers, body) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (value) => chunks.push(value));
  await handlers.get(name)(
    {
      rawUrl: url,
      httpMethod: method,
      headers: Object.fromEntries(new Headers(headers)),
      body: body || null,
      isBase64Encoded: false,
    },
    stream,
    { awsRequestId: randomUUID(), getRemainingTimeInMillis: () => 180000 },
  );
  await finished(stream);
  const metadata = stream.metadata;
  return new Response(
    Buffer.concat(chunks).length ? Buffer.concat(chunks) : null,
    {
      status: metadata.statusCode,
      headers: metadata.headers || metadata.multiValueHeaders,
    },
  );
}
function matches(row, search) {
  for (const [field, filter] of search) {
    if (["select", "order", "limit", "offset"].includes(field)) continue;
    if (filter.startsWith("eq.") && String(row[field]) !== filter.slice(3))
      return false;
    if (
      filter.startsWith("in.(") &&
      !filter
        .slice(4, -1)
        .split(",")
        .map((value) => value.replace(/^"|"$/g, ""))
        .includes(String(row[field]))
    )
      return false;
  }
  return true;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, site || "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks),
      raw = bytes.toString();
    const body =
      raw && request.headers["content-type"]?.includes("application/json")
        ? JSON.parse(raw)
        : null;
    if (url.pathname === "/gemini-fixture") {
      state.modelCalls++;
      state.payloads.push({
        body,
        timeout: request.headers["x-server-timeout"],
      });
      if (state.profileOutputLimit) {
        assert.ok(body.generationConfig?.responseSchema?.properties?.profile);
        return json(response, {
          modelVersion: "gemini-3.8-flash",
          candidates: [
            {
              content: { role: "model", parts: [{ text: '{"profile":{' }] },
              finishReason: "MAX_TOKENS",
            },
          ],
          usageMetadata: {
            candidatesTokenCount: 11010,
            thoughtsTokenCount: 1263,
          },
        });
      }
      if (state.providerFailure)
        return json(
          response,
          {
            error: {
              code: state.providerFailure,
              status:
                state.providerFailure === 400
                  ? "INVALID_ARGUMENT"
                  : "DEADLINE_EXCEEDED",
              message: "Controlled provider failure",
            },
          },
          state.providerFailure,
        );
      if (
        !quick &&
        !state.delayed &&
        body.generationConfig?.responseSchema?.properties?.recovered_profile
      ) {
        state.delayed = true;
        await sleep(31000);
      }
      return json(response, providerReply(body));
    }
    if (url.pathname === "/auth/v1/user") return json(response, user);
    if (url.pathname.startsWith("/rest/v1/")) {
      assert.equal(
        request.headers["accept-profile"] || request.headers["content-profile"],
        "simple_grant",
      );
      const table = url.pathname.slice("/rest/v1/".length);
      if (table === "rpc/claim_ai_request") {
        state.claims++;
        return json(response, true);
      }
      const rows = tables[table];
      assert.ok(rows, `Unexpected fixture table: ${table}`);
      let selected = rows.filter((row) => matches(row, url.searchParams));
      if (request.method === "PATCH") {
        if (table === "organizations") state.orgWrites++;
        for (const row of selected)
          Object.assign(
            row,
            body,
            table === "applications"
              ? { updated_at: new Date().toISOString() }
              : {},
          );
      } else if (request.method === "POST") {
        const row = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...body,
        };
        rows.push(row);
        selected = [row];
      }
      return json(
        response,
        request.headers.accept?.includes("application/vnd.pgrst.object+json")
          ? (selected[0] ?? null)
          : selected,
      );
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      let path = decodeURIComponent(
        url.pathname.slice("/storage/v1/object/".length),
      ).replace(/^authenticated\//, "");
      if (request.method === "POST" || request.method === "PUT") {
        if (objects.has(path) && request.headers["x-upsert"] !== "true")
          return json(
            response,
            {
              statusCode: "409",
              error: "Duplicate",
              message: "The resource already exists",
            },
            409,
          );
        objects.set(path, {
          bytes,
          type: request.headers["content-type"],
          created_at: new Date().toISOString(),
        });
        return json(response, { Key: path, Id: randomUUID() });
      }
      if (request.method === "DELETE") {
        for (const prefix of body.prefixes) objects.delete(`${path}/${prefix}`);
        return json(response, []);
      }
      const item = objects.get(path);
      if (!item)
        return json(
          response,
          {
            statusCode: "404",
            error: "not_found",
            message: "Object not found",
          },
          404,
        );
      response.writeHead(200, {
        "Content-Type": item.type,
        "Cache-Control": "no-store",
      });
      return response.end(item.bytes);
    }
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5);
      if (name === "ai-jobs") state.polls++;
      const result = await invoke(
        name,
        url.href,
        request.method,
        request.headers,
        raw,
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      return response.end(Buffer.from(await result.arrayBuffer()));
    }
    const relative =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(/^\//, "");
    const path = resolve(root, "site", relative);
    assert.ok(path.startsWith(resolve(root, "site") + "/"));
    let content;
    try {
      content = await readFile(path);
    } catch {
      content = await readFile(join(root, "site/index.html"));
    }
    response.writeHead(200, {
      "Content-Type":
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[extname(path)] || "text/html",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    state.errors.push(error);
    json(response, { error: "Runtime fixture failed" }, 500);
  }
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    SUPABASE_URL: site,
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    AUTH_APP_URL: "https://simplegrants.com.au",
    AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
    ...(!live ? { GEMINI_API_KEY: "fixture-gemini" } : {}),
  });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url);
    if (
      url.origin === "https://simplegrants.com.au" &&
      url.pathname === "/.netlify/functions/ai-worker-background"
    ) {
      const work = Promise.resolve()
        .then(async () => {
          const raw = await request.text();
          return invoke(
            "ai-worker-background",
            request.url,
            "POST",
            request.headers,
            raw,
          );
        })
        .catch((error) => state.errors.push(error));
      state.workers.push(work);
      return new Response(null, { status: 202 });
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      if (live && !state.providerFailure) {
        state.modelCalls++;
        state.payloads.push({
          body: JSON.parse(await request.clone().text()),
          timeout: request.headers.get("x-server-timeout"),
        });
        return originalFetch(request);
      }
      return originalFetch(
        new Request(`${site}/gemini-fixture`, {
          method: request.method,
          headers: request.headers,
          body: await request.arrayBuffer(),
          signal: request.signal,
        }),
      );
    }
    return originalFetch(request);
  };
  console.log(
    `Packaging actual Netlify functions; provider mode: ${live ? "LIVE GEMINI" : "isolated HTTP fixture"}`,
  );
  const packaged = await zipFunctions(
    "netlify/functions",
    join(root, "functions"),
    {
      config: { "*": { nodeBundler: "esbuild", nodeVersion: "22.x" } },
      basePath: process.cwd(),
    },
  );
  for (const name of ["ai", "ai-jobs", "ai-worker-background"]) {
    const fn = packaged.find((fn) => fn.name === name);
    assert.ok(fn);
    if (name.endsWith("background"))
      assert.equal(fn.invocationMode, "background");
    const folder = join(root, "unpacked", name);
    for (const [path, content] of Object.entries(
      unzipSync(await readFile(fn.path)),
    )) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), content);
    }
    handlers.set(
      name,
      (await import(pathToFileURL(join(folder, "___netlify-entry-point.mjs"))))
        .handler,
    );
  }
  const unauth = await originalFetch(`${site}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "profile", profileStage: "extract", orgId }),
  });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("content-type"), /application\/json/);
  console.log(
    "PASS: packaged handler accepts Netlify Context and returns JSON before authentication",
  );
  await run(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--outDir", join(root, "site")],
    {
      env: {
        ...process.env,
        VITE_SUPABASE_URL: site,
        VITE_SUPABASE_ANON_KEY: "fixture-anon",
      },
      maxBuffer: 1024 * 1024,
    },
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => state.errors.push(error));
  await page.addInitScript(
    ({ site, token, user }) =>
      localStorage.setItem(
        `simple-grants-auth-v1-${new URL(site).host}`,
        JSON.stringify({
          access_token: token,
          refresh_token: "fixture-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      ),
    { site, token, user },
  );
  await page.goto(`${site}/?view=organisation&org=${orgId}`);
  await page
    .getByRole("button", { name: "Update with AI", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Paste your organisation’s history or information",
    })
    .fill(sourceText);
  const start = Date.now();
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Review your organisation details",
    { timeout: live ? 300000 : 90000 },
  );
  await expect(
    page.getByRole("textbox", { name: "Organisation name", exact: true }),
  ).toHaveValue("Runtime Community Association");
  assert.equal(state.orgWrites, 0);
  assert.equal(state.claims, 3);
  for (const { body } of state.payloads.slice(0, 3)) {
    const sources = JSON.stringify(body.contents);
    for (const document of evidence.filter(
      ({ record }) => record.category === "other",
    ))
      assert.ok(sources.includes(`SOURCE DOCUMENT: ${document.name}`));
    assert.ok(!sources.includes("SOURCE DOCUMENT: Budget.xlsx"));
  }
  console.log(
    `PASS: built browser profile extract → verify → correct (${((Date.now() - start) / 1000).toFixed(1)} seconds); original TXT/DOCX/PDF/XLSX, no automatic approval`,
  );
  await page.screenshot({
    path: join(root, "profile-review.png"),
    fullPage: true,
  });
  await page.goto(`${site}/?view=applications&org=${orgId}`);
  await page.locator(".application-row").click();
  for (const doc of evidence)
    await page
      .getByRole("checkbox", {
        name: `Use ${doc.name} for this draft`,
        exact: true,
      })
      .check();
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/gardening|garden/i, { timeout: live ? 300000 : 60000 });
  const draft = state.applications[0].draft;
  assert.ok(draft.sections.length);
  assert.equal(draft.human_review_required, true);
  for (const section of draft.sections)
    assert.ok(
      section.answer.trim().split(/\s+/).length <= 80,
      "Draft exceeded the real question's 80-word limit",
    );
  assert.equal(state.claims, 5);
  const providerInput = state.payloads
    .map((value) => JSON.stringify(value.body))
    .join("\n");
  assert.match(providerInput, /Budget.*D2/);
  assert.match(providerInput, /1000/);
  assert.match(providerInput, /APPROVED ORGANISATION PROFILE/);
  console.log(
    "PASS: built browser preflight → generated/persisted draft; approved profile, TXT/DOCX/XLSX originals, saved formula evidence and 80-word answer limit",
  );
  await page.screenshot({
    path: join(root, "draft-generated.png"),
    fullPage: true,
  });
  await page.goto(`${site}/?view=opportunities&org=${orgId}`);
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .first()
    .click();
  await expect
    .poll(() => state.claims, { timeout: live ? 300000 : 60000 })
    .toBe(7);
  await expect
    .poll(() => state.grants.length, { timeout: live ? 300000 : 60000 })
    .toBeGreaterThan(1);
  await expect(
    page
      .getByRole("button", { name: "Find grants with AI", exact: true })
      .first(),
  ).toBeEnabled({ timeout: live ? 300000 : 60000 });
  assert.ok(
    state.grants
      .slice(1)
      .every(
        (grant) =>
          grant.source_url.startsWith("https://") &&
          !grant.source_url.includes("grounding-api-redirect"),
      ),
  );
  if (live) assert.ok(state.modelCalls >= 7);
  else assert.equal(state.modelCalls, 7);
  assert.ok(
    quick ? state.polls >= 7 : live ? state.polls >= 7 : state.polls > 7,
  );
  assert.ok(state.payloads.every((value) => value.timeout === "90"));
  console.log(
    `PASS: built browser search → signed extraction → persisted canonical source; ${state.modelCalls} model attempts / seven quota claims, polling never charges`,
  );
  await page.screenshot({
    path: join(root, "search-results.png"),
    fullPage: true,
  });
  // Controlled transport faults also traverse the real SDK, worker and polling.
  const grantsBeforeErrors = state.grants.length;
  for (const [status, code] of [
    [400, "SG_AI_PROVIDER"],
    [504, "SG_AI_TIMEOUT"],
  ]) {
    state.providerFailure = status;
    await expect(
      page
        .getByRole("button", { name: "Find grants with AI", exact: true })
        .first(),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Find grants with AI", exact: true })
      .first()
      .click();
    await expect(page.getByRole("alert")).toContainText(code, {
      timeout: 30000,
    });
    assert.equal(state.grants.length, grantsBeforeErrors);
    console.log(
      `PASS: controlled Gemini ${status} becomes readable ${code}, never SG_AI_RESPONSE`,
    );
  }
  state.providerFailure = 0;
  if (!live) {
    const profileHistory = page.getByRole("textbox", {
      name: "Paste your organisation’s history or information",
    });
    const prepareProfile = page.getByRole("button", {
      name: "Prepare my profile",
      exact: true,
    });
    const publicHistory = page.getByRole("checkbox", {
      name: "PublicHistory.xlsx",
      exact: true,
    });
    const firstAttempt = state.payloads.length;
    state.profileOutputLimit = true;
    await page.goto(`${site}/?view=organisation&org=${orgId}`);
    await page
      .getByRole("button", { name: "Update with AI", exact: true })
      .click();
    await profileHistory.fill(sourceText);
    await prepareProfile.click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      /Reference: [0-9a-f-]{36} \(SG_AI_OUTPUT_LIMIT\)/,
      { timeout: 30000 },
    );
    await expect(alert).toContainText("still saved in your library");
    await expect(profileHistory).toHaveValue(sourceText);
    await expect(publicHistory).toBeChecked();
    await expect(prepareProfile).toBeEnabled();
    assert.equal(
      state.payloads[firstAttempt].body.generationConfig.maxOutputTokens,
      16384,
    );
    assert.equal(state.orgWrites, 0);
    for (const doc of evidence) {
      assert.ok(tables.documents.some((row) => row.id === doc.id));
      assert.deepEqual(
        objects.get(`simple-grant-documents/${doc.record.storage_path}`).bytes,
        Buffer.from(doc.bytes),
      );
    }

    const retryAttempt = state.payloads.length;
    state.profileOutputLimit = false;
    await publicHistory.uncheck();
    await prepareProfile.click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      "Review your organisation details",
      { timeout: 30000 },
    );
    await expect(alert).toHaveCount(0);
    assert.ok(
      !JSON.stringify(state.payloads[retryAttempt].body.contents).includes(
        "SOURCE DOCUMENT: PublicHistory.xlsx",
      ),
    );
    assert.equal(state.orgWrites, 0);
    console.log(
      "PASS: Gemini MAX_TOKENS shows SG_AI_OUTPUT_LIMIT, preserves sources and allows a retry to human review",
    );
  }
  const badId = "6589400b-9984-4d38-95d0-606f738b1430";
  tables.documents.push({
    ...evidence.find((doc) => doc.name === "Charter.docx").record,
    id: badId,
    name: "Broken.docx",
    storage_path: `${orgId}/${badId}/Broken.docx`,
    size_bytes: 8,
  });
  objects.set(`simple-grant-documents/${orgId}/${badId}/Broken.docx`, {
    bytes: Buffer.from("PKbroken"),
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    created_at: new Date().toISOString(),
  });
  const quotaBeforeBadFile = state.claims,
    modelBeforeBadFile = state.modelCalls;
  const rejected = await originalFetch(`${site}/api/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Simple-Grants-Async": "1",
    },
    body: JSON.stringify({
      action: "profile",
      profileStage: "extract",
      orgId,
      documentIds: [badId],
    }),
  });
  assert.equal(rejected.status, 202);
  const job = await rejected.json();
  let fileResult;
  do {
    await sleep(50);
    fileResult = await originalFetch(
      `${site}/api/ai-jobs?${new URLSearchParams(job)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } while (fileResult.status === 202);
  assert.equal(fileResult.status, 422);
  assert.equal(state.claims, quotaBeforeBadFile);
  assert.equal(state.modelCalls, modelBeforeBadFile);
  console.log(
    "PASS: corrupt DOCX rejected through background execution without a quota/model claim",
  );
  await Promise.all(state.workers);
  assert.deepEqual(state.errors, []);
  await page.screenshot({
    path: join(root, "verified-ui.png"),
    fullPage: true,
  });
  console.log(
    `PASS: packaged AI runtime/browser suite complete. Evidence: ${root}`,
  );
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages[0])
      await pages[0].screenshot({
        path: join(root, "failure.png"),
        fullPage: true,
      });
  }
  console.error(`Runtime test evidence: ${root}`);
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  // Keep failure screenshots/log evidence in a private temporary directory.
}
