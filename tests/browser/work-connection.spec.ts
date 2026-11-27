import { expect, test } from "@playwright/test";

const firstId = "d604582e-43d1-448a-8d9b-22f6db989f1e";
const secondId = "306f2bd8-5d18-4ff7-82c2-04c25a8b9784";
const requestId = "68735bfa-d0fe-438f-a567-3853a41055d4";
const callback = "https://chatgpt.com/connector_platform_oauth_redirect";
const applicationId = "2fcdb641-35d2-4ed7-8e8c-458726c5c042";
const savedDraft = {
  id: applicationId,
  org_id: secondId,
  title: "Neighbourhood Connections Grant",
  status: "draft",
  project_details: {},
  draft: {
    application_text: "Approved sample Work draft.",
    readiness_stale: true,
  },
};
const organisations = [
  { id: firstId, name: "First Community" },
  { id: secondId, name: "Second Community" },
].map((org) => ({
  ...org,
  type: "Charity",
  profile: { name: org.name },
  focus_areas: [],
  verification_status: "draft",
  notification_frequency: "never",
}));

test.beforeEach(async ({ page }) => {
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured = true;
export const supabase = {
  auth: {
    getSession: async () => ({data:{session:{access_token:'portal-access-token',user:{id:'test-user',email:'member@example.invalid'}}}}),
    onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}})
  },
  from: table => ({ select: () => ({
    order: async () => ({data:${JSON.stringify(organisations)}}),
    eq: async (_, id) => ({data: table === 'applications' && id === '${secondId}' ? [${JSON.stringify(savedDraft)}] : []})
  }) })
};`,
    }),
  );
});

test("the Work consent screen requires choosing an organisation before returning to ChatGPT", async ({
  page,
}) => {
  const approvals: object[] = [];
  await page.route("**/api/work-oauth/consent**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer portal-access-token");
    if (request.method() === "GET") {
      expect(new URL(request.url()).searchParams.get("request")).toBe(
        requestId,
      );
      return route.fulfill({ json: { pending: true } });
    }
    approvals.push(request.postDataJSON());
    return route.fulfill({
      json: { redirectUrl: callback + "?code=fake-code&state=state" },
    });
  });
  await page.route(callback + "?*", (route) =>
    route.fulfill({ body: "Fixture callback" }),
  );

  await page.goto(`/?work_request=${requestId}&org=${firstId}`);
  await expect(
    page.getByRole("heading", { name: "Connect ChatGPT Work" }),
  ).toBeVisible();
  const allow = page.getByRole("button", { name: "Allow access" });
  await expect(allow).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Organisation", exact: true })
    .selectOption(secondId);
  expect(approvals).toEqual([]);
  await allow.click();
  await expect(page).toHaveURL(callback + "?code=fake-code&state=state");
  expect(approvals).toEqual([{ requestId, orgId: secondId }]);
});

test("disconnect revokes the connection for the current organisation", async ({
  page,
}) => {
  const revoked: object[] = [];
  await page.route("**/api/work-oauth/connections**", async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { connected: true } });
    expect(request.method()).toBe("DELETE");
    revoked.push(request.postDataJSON());
    return route.fulfill({ json: { connected: false } });
  });
  await page.goto(`/?view=organisation&org=${secondId}`);
  await page.getByRole("button", { name: "Disconnect ChatGPT" }).click();
  const card = page.getByRole("region", { name: "ChatGPT Work connection" });
  await expect(card.getByRole("status")).toContainText(
    "To connect this organisation",
  );
  expect(revoked).toEqual([{ orgId: secondId }]);
});

test("the Work review link opens the exact saved draft", async ({ page }) => {
  await page.goto(
    `/?view=applications&org=${secondId}&application=${applicationId}`,
  );
  const editor = page.getByRole("dialog");
  await expect(
    editor.getByRole("heading", { name: savedDraft.title }),
  ).toBeVisible();
  await expect(editor).toContainText("Approved sample Work draft.");
});
