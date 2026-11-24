/** Runs the built UI and packaged Netlify bootstrap; no app handlers/SDKs are mocked.
 * The isolated HTTP fixture supplies Auth/PostgREST/Storage and, by default,
 * controlled Gemini responses. --live exercises the provider on fictional evidence.
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
  charterText,
  providerReply,
  discoveryFixture,
  grantReportFixture,
  setupEvidence,
  setupSourceFacts,
} from "./fixtures.mjs";
import {
  compactRegistrationExcerpt,
  fixtureDocumentFromBytes,
  loadSafeCircle,
  runSafeCircleRounds,
} from "./safe-circle.mjs";
const run = promisify(execFile);
const live = process.argv.includes("--live");
const quick = process.argv.includes("--quick");
const circleDirectory = process.argv
  .find((argument) => argument.startsWith("--safe-circle="))
  ?.slice("--safe-circle=".length);
const liveCircle = process.argv.includes("--live-safe-circle");
const flashModel = "gemini-flash-latest";
const neonModel = "gemini-4-neon";
const reviewDraftPrefix = `simple-grant-documents/.setup-review-drafts/${orgId}/${actorId}`;
const liveFallbacks = [];
if ((live && circleDirectory) || (liveCircle && (!circleDirectory || live)))
  throw Error(
    "Use --live-safe-circle with --safe-circle=PATH for the selected public Safe Circle files, or --live on its own for fictional files.",
  );
if ((live || liveCircle) && !process.env.GEMINI_API_KEY)
  throw Error(
    "Add GEMINI_API_KEY through environment secret settings before running --live.",
  );
const circle =
  circleDirectory && (await loadSafeCircle(circleDirectory, liveCircle));
const root = await mkdtemp(join(tmpdir(), "simplegrants-ai-runtime-"));
if ((live || liveCircle) && process.env.HTTPS_PROXY) {
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
  discoveryRedirects: 0,
  transcriptions: [],
  workers: [],
  setupJobs: new Map(),
  setupEvents: [],
  errors: [],
  providerFailure: 0,
  neonDenials: 0,
  profileOutputLimit: false,
  verificationTimedOut: false,
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
  documents: circle ? [] : evidence.map((doc) => doc.record),
  document_text_extracts: [],
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
function modelFromProviderPath(pathname) {
  const match = /^\/v1(?:beta|alpha)?\/models\/([^/:]+):generateContent$/.exec(
    pathname,
  );
  assert.ok(match, `Unexpected Gemini SDK endpoint ${pathname}`);
  return match[1];
}
function transcriptionPart(body) {
  const parts = body.contents[0].parts;
  return parts.some(({ text }) => text?.startsWith("Transcribe"))
    ? parts.find(({ inlineData }) => inlineData)?.inlineData
    : undefined;
}
let site, browser;
const handlers = new Map();
async function completedAIJob(payload, pollingMs) {
  const response = await originalFetch(`${site}/api/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Simple-Grants-Async": "1",
    },
    body: JSON.stringify({ orgId, ...payload }),
  });
  assert.equal(response.status, 202);
  const job = await response.json();
  do {
    await sleep(pollingMs);
    const result = await originalFetch(
      `${site}/api/ai-jobs?${new URLSearchParams(job)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (result.status !== 202) return result;
  } while (true);
}
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
    if (["select", "order", "limit", "offset", "on_conflict"].includes(field))
      continue;
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
      const model = modelFromProviderPath(url.searchParams.get("sdkPath"));
      const parts = body.contents[0].parts;
      const original = transcriptionPart(body);
      if (original) {
        const real = fixtureDocumentFromBytes(circle, original);
        const charter = evidence.find(({ name }) => name === "Charter.pdf");
        assert.equal(original.mimeType, "application/pdf");
        assert.ok(
          real || Buffer.from(original.data, "base64").equals(charter.bytes),
        );
        state.transcriptions.push(real?.name ?? charter.name);
        return json(response, {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: real?.transcript ?? charterText }],
              },
              finishReason: "STOP",
            },
          ],
        });
      }
      state.modelCalls++;
      state.payloads.push({
        body,
        model,
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
            promptTokenCount: 18000,
            candidatesTokenCount: 11010,
            thoughtsTokenCount: 1263,
          },
        });
      }
      if (
        model === neonModel &&
        body.generationConfig?.responseSchema?.properties?.reviews
      ) {
        state.neonDenials++;
        return json(
          response,
          {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "Model gemini-4-neon is not available to this project.",
            },
          },
          403,
        );
      }
      const verification =
        !!body.generationConfig?.responseSchema?.properties?.recovered_profile;
      const simulateVerificationTimeout =
        !live && verification && !state.verificationTimedOut;
      const providerFailure =
        state.providerFailure || (simulateVerificationTimeout ? 504 : 0);
      if (providerFailure) {
        if (simulateVerificationTimeout) state.verificationTimedOut = true;
        return json(
          response,
          {
            error: {
              code: providerFailure,
              status:
                providerFailure === 400
                  ? "INVALID_ARGUMENT"
                  : "DEADLINE_EXCEEDED",
              message: "Controlled provider failure",
            },
          },
          providerFailure,
        );
      }
      if (!quick && !state.delayed && verification) {
        state.delayed = true;
        await sleep(91000);
      }
      if (
        circle &&
        body.generationConfig?.responseSchema?.properties?.suggestions
      ) {
        const source = circle.find(({ name }) =>
          parts.some(({ text }) =>
            text?.startsWith(`SOURCE DOCUMENT: ${name}.`),
          ),
        );
        const excerpt = compactRegistrationExcerpt(circle);
        assert.ok(
          source || parts[0].text.endsWith(excerpt),
          "Unknown Safe Circle source",
        );
        const suggestions = source
          ? (source.suggestions ?? [])
          : [
              {
                questionKey: "registration_number",
                textValue: circle[0].registrationNumber,
                quote: excerpt,
              },
            ];
        return json(response, {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify({ suggestions }) }],
              },
              finishReason: "STOP",
            },
          ],
        });
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
        const conflictKey = url.searchParams.get("on_conflict");
        selected = [];
        for (const item of Array.isArray(body) ? body : [body]) {
          const row = {
            id: randomUUID(),
            created_at: new Date().toISOString(),
            ...item,
          };
          const duplicate =
            conflictKey &&
            rows.some((existing) =>
              conflictKey.split(",").every((key) => existing[key] === row[key]),
            );
          if (duplicate) continue;
          rows.push(row);
          selected.push(row);
        }
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
        let storageBytes = bytes;
        let type = request.headers["content-type"];
        if (type?.startsWith("multipart/form-data")) {
          const form = await new Response(bytes, {
            headers: { "Content-Type": type },
          }).formData();
          const file = [...form.values()].find(
            (value) => typeof value !== "string",
          );
          assert.ok(file, "Expected a file in the Storage upload");
          storageBytes = Buffer.from(await file.arrayBuffer());
          type = file.type;
        }
        objects.set(path, {
          bytes: storageBytes,
          type,
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
      if (name === "ai" && body?.action?.startsWith("setup-")) {
        assert.equal(result.status, 202);
        const { jobId } = await result.clone().json();
        state.setupJobs.set(jobId, body);
        state.setupEvents.push(["queued", body.action, body.documentIds]);
      }
      const setupJob = state.setupJobs.get(url.searchParams.get("jobId"));
      if (name === "ai-jobs" && setupJob && result.status === 200) {
        state.setupEvents.push([
          "completed",
          setupJob.action,
          setupJob.documentIds,
        ]);
        if (circle && setupJob.action === "setup-source") {
          const { setupSuggestions = [] } = await result.clone().json();
          const keys = [
            ...new Set(setupSuggestions.map(({ questionKey }) => questionKey)),
          ];
          const doc = tables.documents.find(
            ({ id }) => id === setupJob.documentIds[0],
          );
          const source = doc
            ? `file ${circle.findIndex(({ name }) => name === doc.name) + 1} (${doc.category})`
            : "pasted information";
          console.log(
            `Safe Circle ${source} fields: ${keys.join(", ") || "none"}.`,
          );
        }
      }
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
    ...(!live && !liveCircle
      ? { GEMINI_API_KEY: "fixture-gemini", GEMINI_MODEL: flashModel }
      : {}),
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
      if ((live || liveCircle) && !state.providerFailure) {
        const body = JSON.parse(await request.clone().text());
        const original = transcriptionPart(body);
        if (original) {
          if (liveCircle) {
            const selected = fixtureDocumentFromBytes(circle, original);
            if (!selected)
              throw Error(
                "Live check requested a file outside its selected fixtures.",
              );
            state.transcriptions.push(selected.name);
          } else state.transcriptions.push("Charter.pdf");
          return originalFetch(request);
        }
        state.modelCalls++;
        state.payloads.push({
          body,
          model: modelFromProviderPath(url.pathname),
          timeout: request.headers.get("x-server-timeout"),
        });
        return originalFetch(request);
      }
      const fixtureUrl = new URL(`${site}/gemini-fixture`);
      fixtureUrl.searchParams.set("sdkPath", url.pathname);
      return originalFetch(
        new Request(fixtureUrl, {
          method: request.method,
          headers: request.headers,
          body: await request.arrayBuffer(),
          signal: request.signal,
        }),
      );
    }
    if (
      !live &&
      !liveCircle &&
      url.href === discoveryFixture.officialRedirect
    ) {
      assert.ok(["HEAD", "GET"].includes(request.method));
      assert.equal(request.redirect, "manual");
      state.discoveryRedirects++;
      return new Response(null, {
        status: 302,
        headers: { Location: discoveryFixture.officialUrl },
      });
    }
    if (circle && url.origin !== site)
      throw Error(
        "Only local fixture endpoints and the explicitly enabled Gemini test are allowed.",
      );
    return originalFetch(request);
  };
  console.log(
    `Packaging actual Netlify functions; provider mode: ${live || liveCircle ? "LIVE GEMINI" : "isolated HTTP fixture"}`,
  );
  const packaged = await zipFunctions(
    "netlify/functions",
    join(root, "functions"),
    {
      config: { "*": { nodeBundler: "esbuild", nodeVersion: "22.x" } },
      basePath: process.cwd(),
    },
  );
  for (const name of [
    "ai",
    "ai-jobs",
    "ai-worker-background",
    "setup-review-drafts",
  ]) {
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
  if (circle) {
    await page.route(/^https?:\/\//, (route) =>
      new URL(route.request().url()).origin === site
        ? route.continue()
        : route.abort(),
    );
  }
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
  if (circle) {
    await runSafeCircleRounds({
      page,
      url: `${site}/?view=organisation&org=${orgId}`,
      directory: circleDirectory,
      documents: circle,
      rows: tables.documents,
      extracts: tables.document_text_extracts,
      setupEvents: state.setupEvents,
      transcriptions: state.transcriptions,
      currentOrg: () => state.orgs[0],
      live: liveCircle,
    });
  } else {
    await runFictionalRounds(page);
  }
  await Promise.all(state.workers);
  assert.equal(
    state.errors.length,
    0,
    "No browser or fixture errors should occur",
  );
  console.log(
    `PASS: packaged AI runtime/browser suite complete. Evidence: ${root}`,
  );
} catch (error) {
  if (circle) {
    console.error(`Safe Circle check failed. ${error.message.split("\n")[0]}`);
    const testFrame = error.stack
      ?.split("\n")
      .find(
        (line) =>
          line.startsWith("    at ") &&
          line.includes("/tests/runtime/safe-circle.mjs:"),
      );
    if (testFrame) console.error(testFrame.trim());
    process.exitCode = 1;
  } else {
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
  }
} finally {
  globalThis.fetch = originalFetch;
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

async function runFictionalRounds(page) {
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
    { timeout: live ? 300000 : quick ? 90000 : 135000 },
  );
  await expect(
    page.getByRole("textbox", { name: "Organisation name", exact: true }),
  ).toHaveValue("Runtime Community Association");
  await expect
    .poll(() => objects.has(`${reviewDraftPrefix}/profile.json`))
    .toBe(true);
  assert.equal(state.orgWrites, 0);
  assert.equal(state.claims, 3);
  if (!live) {
    assert.equal(state.verificationTimedOut, true);
    assert.equal(state.modelCalls, 4);
    assert.deepEqual(
      state.payloads.map(({ timeout }) => timeout),
      ["90", "120", "120", "90"],
    );
    if (!quick) assert.ok(Date.now() - start >= 91000);
    console.log(
      "PASS: verification retries one Gemini 504, completes review and uses one quota claim for both attempts",
    );
  }
  const ordinaryModel = (
    live ? process.env.GEMINI_MODEL || flashModel : flashModel
  ).replace(/^models\//, "");
  for (const { body, model } of state.payloads) {
    assert.equal(model, ordinaryModel);
    assert.equal(body.generationConfig.maxOutputTokens, 16384);
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
  const callsBeforeDraft = state.payloads.length;
  await page.getByText("Supporting documents", { exact: true }).click();
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
  await page
    .getByText("Edit draft text", { exact: true })
    .click({ timeout: live ? 300000 : 60000 });
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/gardening|garden/i, { timeout: live ? 300000 : 60000 });
  const draft = state.applications[0].draft;
  assert.ok(draft.sections.length);
  assert.equal(draft.human_review_required, true);
  assert.equal(draft.readiness.checks.length, 5);
  assert.deepEqual(
    draft.evidence_sources.map(({ name }) => name).sort(),
    evidence.map(({ name }) => name).sort(),
  );
  for (const section of draft.sections)
    assert.ok(
      section.answer.trim().split(/\s+/).length <= 80,
      "Draft exceeded the real question's 80-word limit",
    );
  assert.equal(state.claims, 5);
  const draftAttempts = state.payloads.slice(callsBeforeDraft);
  const preflightAttempts = draftAttempts.filter(
    ({ body }) => body.generationConfig?.responseSchema?.properties?.documents,
  );
  const writingAttempts = draftAttempts.filter(
    ({ body }) => body.generationConfig?.responseSchema?.properties?.sections,
  );
  assert.ok(preflightAttempts.length > 0);
  assert.deepEqual(state.transcriptions, ["Charter.pdf"]);
  for (const { body } of draftAttempts) {
    const parts = JSON.stringify(body.contents);
    assert.ok(!parts.includes("inlineData"));
  }
  assert.ok(
    draftAttempts.some(({ body }) =>
      JSON.stringify(body.contents).includes("SOURCE DOCUMENT: Charter.pdf"),
    ),
  );
  const charter = evidence.find(({ name }) => name === "Charter.pdf");
  assert.ok(
    tables.document_text_extracts.some(
      ({ document_id, text }) =>
        document_id === charter.id &&
        text.includes("Runtime Community Association"),
    ),
  );
  assert.ok(preflightAttempts.every(({ model }) => model === ordinaryModel));
  assert.equal(writingAttempts[0]?.model, neonModel);
  assert.equal(
    writingAttempts[0]?.body.generationConfig.thinkingConfig?.thinkingLevel,
    "LOW",
  );
  if (!live) assert.equal(writingAttempts.length, 1);
  const writingModel = writingAttempts.at(-1)?.model;
  if (writingModel !== neonModel) {
    assert.equal(writingModel, ordinaryModel);
    liveFallbacks.push("grant draft generation");
  }
  const providerInput = state.payloads
    .map((value) => JSON.stringify(value.body))
    .join("\n");
  assert.match(providerInput, /Budget.*D2/);
  assert.match(providerInput, /1000/);
  assert.match(providerInput, /APPROVED ORGANISATION PROFILE/);
  console.log(
    `PASS: preflight uses ${ordinaryModel} and ${writingModel} produced a draft that preserves source evidence and the 80-word answer limit`,
  );
  await page.screenshot({
    path: join(root, "draft-generated.png"),
    fullPage: true,
  });
  await page.goto(`${site}/?view=opportunities&org=${orgId}`);
  const callsBeforeSearch = state.payloads.length;
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .first()
    .click();
  await expect
    .poll(() => state.claims, { timeout: live ? 300000 : 60000 })
    .toBe(8);
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
  const discoveryCalls = state.payloads.slice(callsBeforeSearch);
  if (!live) {
    const grounded = discoveryCalls.filter(({ body }) => body.tools);
    assert.equal(grounded.length, 4);
    for (const lane of ["local", "sector", "foundations"])
      assert.ok(
        grounded.some(({ body }) =>
          body.contents[0].parts[0].text.startsWith(`Search lane ${lane}`),
        ),
      );
    const verification = grounded[3].body;
    const verificationPrompt = verification.contents[0].parts[0].text;
    assert.ok(verificationPrompt.startsWith("Verify this shortlist"));
    assert.ok(verification.tools.some((tool) => tool.googleSearch));
    assert.ok(verification.tools.some((tool) => tool.urlContext));
    assert.ok(verificationPrompt.includes(discoveryFixture.officialUrl));
    assert.ok(!verificationPrompt.includes(discoveryFixture.preliminaryUrl));
    const extraction = discoveryCalls.at(-1).body;
    assert.ok(
      extraction.generationConfig.responseSchema.properties.opportunities,
    );
    assert.ok(
      JSON.stringify(extraction.contents).includes(
        discoveryFixture.openEvidence,
      ),
    );
    assert.ok(
      !JSON.stringify(extraction.contents).includes(
        discoveryFixture.preliminaryUrl,
      ),
    );
    assert.ok(
      JSON.stringify(extraction.contents).includes(
        discoveryFixture.officialUrl,
      ),
    );
    assert.equal(state.grants.length, 4);
    const rolling = state.grants.find(
      ({ title }) => title === discoveryFixture.title,
    );
    assert.ok(rolling, "The rolling workshop opportunity should be saved");
    assert.equal(rolling.source_url, discoveryFixture.officialUrl);
    assert.ok(state.discoveryRedirects > 0);
    assert.equal(
      rolling.provenance.sources.some(
        ({ uri }) => uri === discoveryFixture.preliminaryUrl,
      ),
      false,
    );
    const dated = state.grants.find(
      ({ title }) => title === discoveryFixture.datedTitle,
    );
    assert.ok(dated, "The dated workshop opportunity should be saved");
    assert.equal(dated.opens_on, null);
    assert.equal(dated.closes_at, null);
    assert.equal(dated.provenance.closing_date, null);
    assert.equal(dated.provenance.round_status, "unknown");
    assert.equal(dated.provenance.fit, "check");
    assert.equal(dated.provenance.round_status_check_required, true);
    const datedCard = page
      .getByRole("article")
      .filter({ hasText: discoveryFixture.datedTitle });
    await expect(datedCard).toContainText("Check current status");
    await expect(datedCard).toContainText("Check deadline");
    const retrievedDate = state.grants.find(
      ({ title }) => title === discoveryFixture.retrievedDateTitle,
    );
    assert.ok(
      retrievedDate,
      "The retrieved workshop opportunity should be saved",
    );
    assert.equal(retrievedDate.closes_at, null);
    assert.equal(
      retrievedDate.provenance.closing_date,
      discoveryFixture.deadlineDate,
    );
    await expect(
      page.getByRole("heading", { name: discoveryFixture.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(discoveryFixture.closedTitle, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(discoveryFixture.equipmentTitle, { exact: true }),
    ).toHaveCount(0);
  }
  assert.ok(discoveryCalls.every(({ model }) => model === ordinaryModel));
  assert.ok(quick || live ? state.polls >= 8 : state.polls > 8);
  for (const { body, timeout } of state.payloads) {
    const verification =
      !!body.generationConfig?.responseSchema?.properties?.recovered_profile;
    const maxTimeout = verification ? 120 : 90;
    assert.ok(Number(timeout) > 0 && Number(timeout) <= maxTimeout);
    if (!live && !body.tools) assert.equal(Number(timeout), maxTimeout);
  }
  console.log(
    `PASS: built browser search lanes → signed verification → extracted and saved canonical source; ${state.modelCalls} model attempts / eight quota claims, polling never charges`,
  );
  await page.screenshot({
    path: join(root, "search-results.png"),
    fullPage: true,
  });
  if (!live) {
    const reportId = randomUUID();
    const storagePath = `${orgId}/${reportId}/${grantReportFixture.fileName}`;
    const bytes = Buffer.from(grantReportFixture.fileText);
    tables.documents.push({
      id: reportId,
      org_id: orgId,
      category: "grant_research",
      name: grantReportFixture.fileName,
      storage_path: storagePath,
      mime_type: "text/plain",
      size_bytes: bytes.length,
      verified: false,
      created_at: new Date().toISOString(),
    });
    objects.set(`simple-grant-documents/${storagePath}`, {
      bytes,
      type: "text/plain",
      created_at: new Date().toISOString(),
    });
    const countBefore = state.grants.length;
    const claimsBefore = state.claims;
    const readsBefore = state.payloads.length;
    const previewResponse = await completedAIJob(
      {
        action: "import-grant",
        importStage: "preview",
        text: grantReportFixture.pastedText,
        documentIds: [reportId],
      },
      20,
    );
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200, JSON.stringify(preview));
    assert.equal(preview.importCandidates.length, 2);
    assert.equal(state.grants.length, countBefore);
    const providerSources = JSON.stringify(
      state.payloads[readsBefore].body.contents,
    );
    assert.ok(providerSources.includes(grantReportFixture.fileName));
    assert.ok(providerSources.includes(grantReportFixture.pastedText));
    assert.ok(providerSources.includes(grantReportFixture.fileText));
    const selection = {
      action: "import-grant",
      importStage: "save",
      orgId,
      importCandidates: preview.importCandidates,
      selectedIndexes: [
        preview.importCandidates.findIndex(
          ({ title }) => title === grantReportFixture.selectedTitle,
        ),
      ],
      sourceFingerprint: preview.sourceFingerprint,
      stageIssuedAt: preview.stageIssuedAt,
    };
    async function saveReport() {
      const response = await originalFetch(`${site}/api/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Simple-Grants-Async": "1",
        },
        body: JSON.stringify(selection),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    }
    const saved = await saveReport();
    assert.equal(saved.importedCount, 1);
    assert.equal(
      saved.opportunities[0].title,
      grantReportFixture.selectedTitle,
    );
    assert.equal(saved.opportunities[0].closes_at, null);
    assert.equal(saved.opportunities[0].provenance.closing_date, "2027-03-31");
    assert.equal(saved.opportunities[0].provenance.source_verified, false);
    assert.equal((await saveReport()).duplicateCount, 1);
    assert.equal(state.grants.length, countBefore + 1);
    assert.equal(state.claims, claimsBefore + 1);
    assert.equal(state.payloads.length, readsBefore + 1);
    console.log(
      "PASS: external report preview reads pasted notes and the selected upload without saving, then only saves the confirmed lead and skips a repeated save",
    );
  }
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
    const beforeLimitedAttempt = {
      claims: state.claims,
      modelCalls: state.modelCalls,
    };
    state.profileOutputLimit = true;
    await page.goto(`${site}/?view=organisation&org=${orgId}`);
    await page
      .getByRole("button", { name: "Resume profile draft", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      "Review your organisation details",
    );
    await page
      .getByRole("button", { name: "Back to sources", exact: true })
      .click();
    await profileHistory.fill(sourceText);
    await prepareProfile.click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      /Reference: [0-9a-f-]{36} \(SG_AI_OUTPUT_LIMIT\)/,
      { timeout: 30000 },
    );
    await expect(alert).toContainText("response length limit");
    await expect(alert).toContainText("still saved in your library");
    await expect(profileHistory).toHaveValue(sourceText);
    await expect(publicHistory).toBeChecked();
    await expect(prepareProfile).toBeEnabled();
    assert.equal(state.claims, beforeLimitedAttempt.claims + 1);
    assert.equal(state.modelCalls, beforeLimitedAttempt.modelCalls + 1);
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

    const reviewedDescription = "Gardening workshops for families in Victoria.";
    await page
      .getByRole("textbox", {
        name: "What your organisation does",
        exact: true,
      })
      .fill(reviewedDescription);
    await page
      .getByRole("checkbox", { name: /I checked these differences/ })
      .check();
    await page
      .getByRole("checkbox", { name: /I have checked these details/ })
      .check();
    await page.getByRole("button", { name: "Approve and save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(objects.has(`${reviewDraftPrefix}/profile.json`), false);
    assert.equal(state.orgWrites, 1);
    assert.equal(state.orgs[0].profile.description, reviewedDescription);
    assert.equal(state.orgs[0].profile.mission, org.profile.mission);
    console.log(
      "PASS: explicit profile approval saves reviewed details and preserves the pre-existing mission",
    );

    const savedBeforeSetup = structuredClone(state.orgs[0]);
    const claimsBeforeSetup = state.claims;
    const callsBeforeSetup = state.payloads.length;
    for (const doc of setupEvidence) {
      tables.documents.push(doc.record);
      objects.set(`simple-grant-documents/${doc.record.storage_path}`, {
        bytes: Buffer.from(doc.bytes),
        type: doc.mime_type,
        created_at: new Date().toISOString(),
      });
    }
    await page.goto(`${site}/?view=organisation&org=${orgId}`);
    await page
      .getByRole("button", { name: "Set up for grants", exact: true })
      .click();
    const wizard = page.getByRole("dialog");
    await expect(wizard).toHaveAccessibleName(
      "Set up your organisation for grants",
    );
    await expect(
      wizard.getByRole("checkbox", { name: "Budget.xlsx", exact: true }),
    ).toHaveCount(0);
    for (const { name } of setupSourceFacts)
      await wizard.getByRole("checkbox", { name, exact: true }).check();
    await wizard.getByRole("button", { name: "Suggest answers" }).click();
    await expect(wizard).toHaveAccessibleName("Review grant setup answers", {
      timeout: 30000,
    });
    await expect(wizard.getByText("Draft saved for later.")).toBeVisible();
    const setupDraftPath = `${reviewDraftPrefix}/grant-setup.json`;
    const setupDraft = JSON.parse(objects.get(setupDraftPath).bytes.toString());
    assert.deepEqual(
      setupDraft.data.evidence.map(({ quote }) => quote),
      setupSourceFacts.map(({ quote }) => quote),
    );
    const legalName = wizard.getByRole("group", {
      name: "What is your registered legal name?",
      exact: true,
    });
    await expect(
      legalName.getByText("Sources disagree. Which answer applies?"),
    ).toBeVisible();
    for (const { value, quote } of setupSourceFacts) {
      await legalName
        .locator(".grant-setup-alternative")
        .filter({ hasText: value })
        .getByText("View source", { exact: true })
        .click();
      await expect(legalName.getByText(quote, { exact: true })).toBeVisible();
    }
    await expect(
      legalName
        .locator(".grant-setup-alternative")
        .filter({ hasText: setupSourceFacts[1].value })
        .getByText(/Suggested by the second review/),
    ).toBeVisible();
    await expect(legalName.getByRole("textbox")).toHaveValue("");
    await expect(
      wizard.getByRole("button", { name: "Save reviewed answers" }),
    ).toBeDisabled();
    assert.equal(state.orgWrites, 1);
    assert.deepEqual(state.orgs[0], savedBeforeSetup);
    assert.equal(state.claims, claimsBeforeSetup + 3);
    assert.equal(state.payloads.length, callsBeforeSetup + 4);
    assert.equal(state.neonDenials, 1);
    assert.deepEqual(state.setupEvents, [
      ...setupSourceFacts.flatMap(({ id }) => [
        ["queued", "setup-source", [id]],
        ["completed", "setup-source", [id]],
      ]),
      ["queued", "setup-conflicts", []],
      ["completed", "setup-conflicts", []],
    ]);
    const setupAttempts = state.payloads.slice(callsBeforeSetup);
    assert.deepEqual(
      setupAttempts.map(({ model }) => model),
      [flashModel, flashModel, neonModel, flashModel],
    );
    assert.equal(
      setupAttempts[2].body.generationConfig.thinkingConfig?.thinkingLevel,
      "LOW",
    );
    assert.equal(
      setupAttempts[3].body.generationConfig.thinkingConfig,
      undefined,
    );
    const [firstSource, secondSource, conflict, fallbackConflict] =
      setupAttempts.map(({ body }) => JSON.stringify(body.contents));
    assert.equal(fallbackConflict, conflict);
    for (const [index, source] of [firstSource, secondSource].entries()) {
      assert.ok(source.includes(setupSourceFacts[index].quote));
      assert.ok(source.includes(setupSourceFacts[index].remainder));
      assert.ok(!source.includes(setupSourceFacts[1 - index].quote));
    }
    for (const { name, quote, remainder } of setupSourceFacts) {
      assert.ok(conflict.includes(quote));
      assert.ok(!conflict.includes(name));
      assert.ok(!conflict.includes(remainder));
    }
    assert.ok(!conflict.includes("inlineData"));
    console.log(
      "PASS: Flash reads each original separately; Neon LOW compares excerpts and falls back on denied access in the same job and quota claim",
    );
    await legalName
      .locator(".grant-setup-alternative")
      .filter({ hasText: setupSourceFacts[1].value })
      .getByRole("button", { name: "Use this answer" })
      .click();
    await wizard
      .getByRole("checkbox", { name: /I’ve checked the answers/ })
      .check();
    await wizard.getByRole("button", { name: "Save reviewed answers" }).click();
    await expect(wizard).toHaveCount(0);
    assert.equal(state.orgWrites, 2);
    assert.equal(state.orgs[0].profile.legal_name, setupSourceFacts[1].value);
    assert.equal(objects.has(setupDraftPath), false);
    console.log(
      "PASS: packaged setup saves private review progress and removes it after explicit approval",
    );
  }
  if (live) {
    const attemptsBeforeConflict = state.payloads.length;
    const claimsBeforeConflict = state.claims;
    const originalOrg = structuredClone(state.orgs[0]);
    const conflict = await completedAIJob(
      {
        action: "setup-conflicts",
        conflicts: [
          {
            questionKey: "legal_name",
            candidates: setupSourceFacts.map(({ value, quote, name }) => ({
              value,
              quote,
              sourceLabel: name,
            })),
          },
        ],
      },
      1000,
    );
    assert.equal(conflict.status, 200);
    const [review] = (await conflict.json()).setupConflicts;
    assert.equal(review.questionKey, "legal_name");
    assert.deepEqual(
      review.alternatives.map(({ quote }) => quote),
      setupSourceFacts.map(({ quote }) => quote),
    );
    assert.deepEqual(state.orgs[0], originalOrg);
    assert.equal(state.claims, claimsBeforeConflict + 1);
    const attempts = state.payloads.slice(attemptsBeforeConflict);
    assert.equal(attempts[0]?.model, neonModel);
    assert.equal(
      attempts[0]?.body.generationConfig.thinkingConfig?.thinkingLevel,
      "LOW",
    );
    const conflictModel = attempts.at(-1)?.model;
    if (conflictModel !== neonModel) {
      assert.equal(conflictModel, ordinaryModel);
      liveFallbacks.push("setup conflict review");
    }
    console.log(
      `PASS: ${conflictModel} reviewed the fictional excerpts and both original alternatives remain unsaved`,
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
  const fileResult = await completedAIJob(
    {
      action: "profile",
      profileStage: "extract",
      documentIds: [badId],
    },
    50,
  );
  assert.equal(fileResult.status, 422);
  assert.equal(state.claims, quotaBeforeBadFile);
  assert.equal(state.modelCalls, modelBeforeBadFile);
  console.log(
    "PASS: corrupt DOCX rejected through background execution without a quota/model claim",
  );
  await page.screenshot({
    path: join(root, "verified-ui.png"),
    fullPage: true,
  });
  assert.equal(
    liveFallbacks.length,
    0,
    `Live Neon could not be verified because Flash handled ${liveFallbacks.join(" and ")}.`,
  );
}
