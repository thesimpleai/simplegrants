import { expect, test, type Page } from "@playwright/test";

async function prepareSignIn(page: Page) {
  const forbiddenRequests: string[] = [];
  page.on("request", (request) => {
    if (/cloudflare|turnstile|\/auth\/v1\/otp/i.test(request.url())) {
      forbiddenRequests.push(request.url());
    }
  });
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured = true;
export const supabase = {auth:{
 getSession:async()=>({data:{session:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
 signInWithOtp:async()=>{window.__nativeOtpCalls=(window.__nativeOtpCalls||0)+1;return {data:{},error:null};}
}};`,
    }),
  );
  await page.route("**/auth/v1/otp*", (route) => route.abort());
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.abort(),
  );
  return {
    forbiddenRequests,
    assertNoOtherAuthProviders: async () => {
      expect(forbiddenRequests).toEqual([]);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __nativeOtpCalls?: number })
              .__nativeOtpCalls ?? 0,
        ),
      ).toBe(0);
      await expect(
        page.locator('script[src*="cloudflare"], iframe[src*="cloudflare"]'),
      ).toHaveCount(0);
    },
  };
}

const submittedNotice =
  "If this address can sign in, you’ll receive an email from Simple Grants.";

test("email sign-in is immediately usable and preserves the grant destination through the app endpoint", async ({
  page,
}) => {
  const checks = await prepareSignIn(page);
  const requests: unknown[] = [];
  await page.route("**/api/auth-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  const org = "6a03978d-6266-46b6-b35e-bf8069e50743";
  const grant = "6a03978d-6266-46b6-b35e-bf8069e50744";
  const next = `/?view=opportunities&org=${org}&grant=${grant}`;
  await page.goto(next);
  await page
    .getByRole("textbox", { name: "Your email address", exact: true })
    .fill("member@example.invalid");
  const submit = page.getByRole("button", { name: "Email me a sign-in link" });
  await expect(submit).toBeEnabled();
  expect(requests).toEqual([]);
  await submit.click();
  await expect(page.getByText(submittedNotice, { exact: false })).toBeVisible();
  expect(requests).toEqual([
    { email: "member@example.invalid", next, website: "" },
  ]);
  await checks.assertNoOtherAuthProviders();
});

test("a request in progress disables the button and prevents duplicate form submissions", async ({
  page,
}) => {
  const checks = await prepareSignIn(page);
  const requests: unknown[] = [];
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/auth-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await responseGate;
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Your email address" })
    .fill("member@example.invalid");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Sending your link…" }),
  ).toBeDisabled();
  await page.locator("form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  releaseResponse();
  await expect(page.getByText(submittedNotice, { exact: false })).toBeVisible();
  expect(requests).toHaveLength(1);
  await checks.assertNoOtherAuthProviders();
});

test("a failed request displays an error and allows an ordinary email retry", async ({
  page,
}) => {
  const checks = await prepareSignIn(page);
  const requests: unknown[] = [];
  await page.route("**/api/auth-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(
      requests.length === 1
        ? {
            status: 503,
            json: {
              error: "Sign-in is temporarily unavailable. Please try again.",
            },
          }
        : { status: 202, json: { accepted: true } },
    );
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Your email address" })
    .fill("member@example.invalid");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sign-in is temporarily unavailable",
  );
  const retry = page.getByRole("button", { name: "Email me a sign-in link" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByText(submittedNotice, { exact: false })).toBeVisible();
  expect(requests).toEqual([
    { email: "member@example.invalid", next: "/", website: "" },
    { email: "member@example.invalid", next: "/", website: "" },
  ]);
  await checks.assertNoOtherAuthProviders();
});

test("the hidden website field is excluded from normal interaction but included in the request", async ({
  page,
}) => {
  const checks = await prepareSignIn(page);
  const requests: unknown[] = [];
  await page.route("**/api/auth-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Your email address" })
    .fill("member@example.invalid");
  const trap = page.locator('input[name="website"]');
  await expect(trap).toHaveAttribute("autocomplete", "off");
  await expect(trap).toHaveAttribute("tabindex", "-1");
  expect(
    await trap.evaluate((input) =>
      Boolean(input.closest('[aria-hidden="true"]')),
    ),
  ).toBe(true);
  await trap.evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "https://automated.example.invalid");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(submittedNotice, { exact: false })).toBeVisible();
  expect(requests).toEqual([
    {
      email: "member@example.invalid",
      next: "/",
      website: "https://automated.example.invalid",
    },
  ]);
  await checks.assertNoOtherAuthProviders();
});
