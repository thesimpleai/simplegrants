import { expect, test, type Page } from "@playwright/test";

const token = "test-hash-for-sign-in-confirmation-1234567890";
const org = "1c27d46e-16e1-4ebf-a6ec-e82f0a9ab3c4";
async function mockAuth(
  page: Page,
  result: { data: { session: unknown }; error: unknown },
) {
  const calls: { token_hash: string; type: string }[] = [];
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured = true;
export const supabase = { auth: {
  verifyOtp: async input => (await fetch('/test-confirm-otp', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)})).json(),
  getSession: async () => ({data:{session:null},error:null}),
  onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}})
}};`,
    }),
  );
  await page.route("**/test-confirm-otp", async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: result });
  });
  return calls;
}

test("a confirmation visit clears the fragment and only an explicit click consumes the email token", async ({
  page,
}) => {
  const calls = await mockAuth(page, {
    data: { session: { access_token: "test-session" } },
    error: null,
  });
  const next = `/?view=opportunities&org=${org}`;
  await page.goto(
    `/auth/confirm#token_hash=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`,
  );
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`\\/\\?view=opportunities&org=${org}$`),
  );
  expect(calls).toEqual([{ token_hash: token, type: "email" }]);
});

test("a missing or malformed fragment offers a new link without verifying or sending email", async ({
  page,
}) => {
  const calls = await mockAuth(page, {
    data: { session: null },
    error: null,
  });
  await page.goto("/auth/confirm#token_hash=bad&type=recovery");
  await expect(
    page.getByRole("heading", { name: "Let’s get you a new link." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to sign-in" }),
  ).toHaveAttribute("href", "/");
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls).toEqual([]);
});

test("an expired or used token shows a generic error without exposing SDK text or token", async ({
  page,
}) => {
  const calls = await mockAuth(page, {
    data: { session: null },
    error: { message: `upstream-internal-detail ${token}` },
  });
  await page.goto(`/auth/confirm#token_hash=${token}`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Please request a new link.",
  );
  await expect(page.locator("body")).not.toContainText(
    "upstream-internal-detail",
  );
  await expect(page.locator("body")).not.toContainText(token);
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls).toHaveLength(1);
});

test("a response without a session cannot complete sign-in", async ({
  page,
}) => {
  const calls = await mockAuth(page, { data: { session: null }, error: null });
  await page.goto(`/auth/confirm#token_hash=${token}`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This sign-in link could not be used.",
  );
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls).toEqual([{ token_hash: token, type: "email" }]);
});

test("sign-in cannot redirect to an external return URL", async ({ page }) => {
  const calls = await mockAuth(page, {
    data: { session: { access_token: "test-session" } },
    error: null,
  });
  const externalNavigations: string[] = [];
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).hostname !== "localhost"
    )
      externalNavigations.push(request.url());
  });
  await page.goto(
    `/auth/confirm#token_hash=${token}&next=${encodeURIComponent("https://untrusted.example/steal")}`,
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(calls).toHaveLength(1);
  expect(externalNavigations).toEqual([]);
});
