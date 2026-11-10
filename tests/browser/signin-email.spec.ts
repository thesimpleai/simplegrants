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
              error:
                "Simple Grants sign-in is temporarily unavailable. Please try again. Reference: 3e652827-650e-49cb-959b-e94361cf070f (SG_AUTH_DATABASE).",
              code: "SG_AUTH_DATABASE",
              reference: "3e652827-650e-49cb-959b-e94361cf070f",
              diagnostic: "private-response-marker",
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
    "Simple Grants sign-in is temporarily unavailable",
  );
  await expect(page.getByRole("alert")).toContainText(
    "3e652827-650e-49cb-959b-e94361cf070f (SG_AUTH_DATABASE)",
  );
  await expect(page.locator("body")).not.toContainText(
    "private-response-marker",
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

const invalidResponses = [
  {
    name: "a 200 HTML SPA fallback",
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body>private-response-marker</body></html>",
  },
  {
    name: "a 500 HTML error page",
    status: 500,
    contentType: "text/html",
    body: "<html><body>private-response-marker</body></html>",
  },
  {
    name: "a 500 JSON error payload",
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "private-response-marker" }),
  },
  {
    name: "malformed acknowledgement JSON",
    status: 202,
    contentType: "application/json",
    body: '{"accepted":private-response-marker}',
  },
  {
    name: "a truthy non-boolean acknowledgement",
    status: 202,
    contentType: "application/json",
    body: JSON.stringify({
      accepted: "true",
      error: "private-response-marker",
    }),
  },
  {
    name: "a null JSON response",
    status: 202,
    contentType: "application/json",
    body: "null",
  },
  {
    name: "a valid acknowledgement with the wrong HTTP status",
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ accepted: true }),
  },
];
for (const response of invalidResponses) {
  test(`sign-in rejects ${response.name} without showing a sent-email notice`, async ({
    page,
  }) => {
    const checks = await prepareSignIn(page);
    await page.route("**/api/auth-email", (route) => route.fulfill(response));
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Your email address" })
      .fill("member@example.invalid");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert")).toContainText("SG_AUTH_RESPONSE");
    await expect(page.getByText(submittedNotice, { exact: false })).toHaveCount(
      0,
    );
    await expect(page.locator(".toast")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "private-response-marker",
    );
    await expect(
      page.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
    await checks.assertNoOtherAuthProviders();
  });
}

test("a failed sign-in connection shows a safe network reference and permits retry", async ({
  page,
}) => {
  const checks = await prepareSignIn(page);
  let requests = 0;
  await page.route("**/api/auth-email", (route) => {
    requests++;
    return requests === 1
      ? route.abort()
      : route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Your email address" })
    .fill("member@example.invalid");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("alert")).toContainText("SG_AUTH_NETWORK");
  await expect(page.getByText(submittedNotice, { exact: false })).toHaveCount(
    0,
  );
  const retry = page.getByRole("button", { name: "Email me a sign-in link" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByText(submittedNotice, { exact: false })).toBeVisible();
  expect(requests).toBe(2);
  await checks.assertNoOtherAuthProviders();
});
