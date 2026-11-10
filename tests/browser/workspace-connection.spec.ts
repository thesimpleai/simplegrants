import { expect, test, type Page } from "@playwright/test";

const firstUser = {
  id: "49058414-086f-47e5-8caa-963dddcf9134",
  email: "member@example.invalid",
};
const secondUser = {
  id: "97cb5d7d-3d6c-4eb9-9653-d6ae816f1c81",
  email: "other@example.invalid",
};
const organisation = (id: string, name: string) => ({
  id,
  name,
  abn: null,
  type: "Charity",
  state: "VIC",
  description: "Community support",
  focus_areas: ["Community"],
  profile: { name },
  notification_frequency: "weekly",
  verification_status: "draft",
  inbox_alias: "test-inbox",
  created_at: "2026-01-01T00:00:00Z",
});
const firstOrg = organisation(
  "ea571b98-4bde-49ef-866d-116b4bc48190",
  "First Organisation",
);
const secondOrg = organisation(
  "cd53185f-f90f-4f6e-8d1d-7c2a09232272",
  "Second Organisation",
);

async function mockWorkspace(page: Page) {
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured = true;
let currentUser = null;
let onAuth = null;
window.__changeWorkspaceUser = user => { currentUser = user; if(onAuth) onAuth(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? {user} : null); };
export const supabase = {
 auth: {
  getSession: async () => { const response=await fetch('/test-workspace-session'); const result=await response.json(); currentUser=result.data?.session?.user??null; return result; },
  onAuthStateChange: callback => {onAuth=callback;return {data:{subscription:{unsubscribe(){if(onAuth===callback)onAuth=null;}}}};},
  signOut: async () => { window.__changeWorkspaceUser(null); return {error:null}; }
 },
 from: table => ({select: () => ({
  order: async () => { const requestedUser=currentUser?.id??'';const result=await (await fetch('/test-workspace-organisations?user='+encodeURIComponent(requestedUser))).json();(window.__completedWorkspaceLists??=[]).push(requestedUser);return result; },
  eq: async (field,orgId) => (await fetch('/test-workspace-records?table='+encodeURIComponent(table)+'&org='+encodeURIComponent(orgId))).json()
 })}),
 rpc: async (name,args) => (await fetch('/test-workspace-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json()
};`,
    }),
  );
  await page.route("**/test-workspace-session", (route) =>
    route.fulfill({
      json: { data: { session: { user: firstUser } }, error: null },
    }),
  );
  await page.route("**/test-workspace-records*", (route) =>
    route.fulfill({ json: { data: [], error: null } }),
  );
}

test("a refused organisation list stays visible as one persistent error, then retry permits a genuinely empty workspace", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.clock.install();
  let failed = true;
  let createRequests = 0;
  await page.route("**/test-workspace-organisations*", (route) =>
    route.fulfill({
      json: failed
        ? {
            data: null,
            error: { code: "42501", message: "private-diagnostic-marker" },
          }
        : { data: [], error: null },
    }),
  );
  await page.route("**/test-workspace-create", (route) => {
    createRequests++;
    return route.fulfill({ json: { data: firstOrg, error: null } });
  });
  await page.goto("/");
  const issue = page.getByRole("alert");
  await expect(issue).toHaveCount(1);
  await expect(issue).toContainText("Please contact support, then try again.");
  await expect(
    page.getByRole("heading", { name: "Your community’s next chapter." }),
  ).toHaveCount(0);
  await expect(page.locator(".org-switch")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add an organisation", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "private-diagnostic-marker",
  );
  await expect(page.locator("body")).not.toContainText("simple_grant");
  await page.clock.fastForward(7000);
  await expect(issue).toBeVisible();
  expect(createRequests).toBe(0);
  failed = false;
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Your community’s next chapter." }),
  ).toBeVisible();
  await expect(issue).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add an organisation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Organisation name", exact: true })
    .fill("First Organisation");
  await page
    .getByRole("button", { name: "Create organisation", exact: true })
    .click();
  await expect(page.locator(".org-switch")).toContainText("First Organisation");
  expect(createRequests).toBe(1);
});

test("a rejected organisation request can retry into the existing organisation without showing a new-org prompt", async ({
  page,
}) => {
  await mockWorkspace(page);
  let failed = true;
  await page.route("**/test-workspace-organisations*", (route) =>
    failed
      ? route.abort()
      : route.fulfill({ json: { data: [firstOrg], error: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Check your internet connection",
  );
  await expect(
    page.getByRole("heading", { name: "Your community’s next chapter." }),
  ).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.locator(".org-switch")).toContainText("First Organisation");
  await expect(
    page.getByRole("heading", {
      name: "A little clarity. A lot of possibility.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a rejected session restore shows a recoverable error and never treats it as a signed-in empty workspace", async ({
  page,
}) => {
  await mockWorkspace(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let failed = true;
  await page.route("**/test-workspace-session", (route) =>
    failed
      ? route.abort()
      : route.fulfill({ json: { data: { session: null }, error: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "couldn’t restore your sign-in session",
  );
  await expect(
    page.getByRole("textbox", { name: "Your email address" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your community’s next chapter." }),
  ).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("textbox", { name: "Your email address" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("failed organisation records retain a persistent error and retry the records rather than the organisation list", async ({
  page,
}) => {
  await mockWorkspace(page);
  let listRequests = 0;
  let recordsFailed = true;
  await page.route("**/test-workspace-organisations*", (route) => {
    listRequests++;
    return route.fulfill({ json: { data: [firstOrg], error: null } });
  });
  await page.route("**/test-workspace-records*", (route) =>
    route.fulfill({
      json: recordsFailed
        ? {
            data: null,
            error: { code: "42501", message: "private-ledger-diagnostic" },
          }
        : { data: [], error: null },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Please contact support");
  await expect(page.locator(".org-switch")).toContainText("First Organisation");
  await expect(
    page.getByRole("heading", { name: "Your community’s next chapter." }),
  ).toHaveCount(0);
  const loadedListRequests = listRequests;
  recordsFailed = false;
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little clarity. A lot of possibility.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(listRequests).toBe(loadedListRequests);
});

test("a stale organisation response cannot replace another user’s workspace and signing out clears connection state", async ({
  page,
}) => {
  await mockWorkspace(page);
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted = false;
  await page.route("**/test-workspace-organisations*", async (route) => {
    const requestUser = new URL(route.request().url()).searchParams.get("user");
    if (requestUser === firstUser.id) {
      firstStarted = true;
      await firstResponse;
      await route.fulfill({ json: { data: [firstOrg], error: null } });
    } else await route.fulfill({ json: { data: [secondOrg], error: null } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => firstStarted).toBe(true);
  await page.evaluate(
    (user) =>
      (
        window as unknown as { __changeWorkspaceUser: (user: unknown) => void }
      ).__changeWorkspaceUser(user),
    secondUser,
  );
  await expect(page.locator(".org-switch")).toContainText(
    "Second Organisation",
  );
  releaseFirst();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __completedWorkspaceLists?: string[] })
            .__completedWorkspaceLists ?? [],
      ),
    )
    .toContain(firstUser.id);
  await expect(page.locator(".org-switch")).toContainText(
    "Second Organisation",
  );
  await expect(page.locator("body")).not.toContainText("First Organisation");
  // Bottom controls and main navigation must stay reachable at the default 720px viewport.
  await page
    .getByRole("button", { name: "Organisation settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A home for your organisation." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little clarity. A lot of possibility.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Your email address" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Second Organisation");
});
