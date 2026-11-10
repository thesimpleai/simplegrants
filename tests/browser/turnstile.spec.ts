import { expect, test, type Page } from "@playwright/test";

async function prepareTurnstile(page: Page) {
  let scriptLoads = 0;
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured = true;
export const supabase = {auth:{
 getSession:async()=>({data:{session:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
}};`,
    }),
  );
  await page.route("**/src/App.tsx*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      "import.meta.env.VITE_TURNSTILE_SITE_KEY",
      '"public-test-site-key"',
    );
    await route.fulfill({ response, body });
  });
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    async (route) => {
      scriptLoads += 1;
      await route.fulfill({
        contentType: "application/javascript",
        body: `const test = window.__turnstileTest = {widgets: new Map(), actions:[], removed:[], sequence:0};
window.turnstile = {
 render(container,options){
  const id = 'test-widget-'+(++test.sequence);
  const button = document.createElement('button');
  button.type='button'; button.textContent='Complete test verification';
  button.onclick=()=>options.callback('test-verification-token');
  container.appendChild(button);
  test.widgets.set(id,{container,button,options}); test.actions.push(options.action);
  return id;
 },
 remove(id){const widget=test.widgets.get(id);if(widget)widget.button.remove();test.widgets.delete(id);test.removed.push(id);}
};`,
      });
    },
  );
  return () => scriptLoads;
}

test("Turnstile survives StrictMode, uses the required action and clears expired tokens", async ({
  page,
}) => {
  const getScriptLoads = await prepareTurnstile(page);
  await page.goto("/");
  const emailSubmit = page.getByRole("button", {
    name: "Email me a sign-in link",
  });
  await expect(
    page.getByRole("button", { name: "Complete test verification" }),
  ).toHaveCount(1);
  await expect(emailSubmit).toBeDisabled();
  expect(getScriptLoads()).toBe(1);
  await page
    .getByRole("button", { name: "Complete test verification" })
    .click();
  await expect(emailSubmit).toBeEnabled();
  const state = await page.evaluate(() => {
    const testState = (
      window as unknown as {
        __turnstileTest: {
          widgets: Map<string, { options: { "expired-callback": () => void } }>;
          actions: string[];
        };
      }
    ).__turnstileTest;
    testState.widgets.values().next().value!.options["expired-callback"]();
    return { active: testState.widgets.size, actions: testState.actions };
  });
  expect(state).toEqual({ active: 1, actions: ["simple-grants-sign-in"] });
  await expect(emailSubmit).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Verification expired");
  await page.getByRole("button", { name: "Try verification again" }).click();
  await expect(
    page.getByRole("button", { name: "Complete test verification" }),
  ).toHaveCount(1);
  expect(getScriptLoads()).toBe(1);
  const cleanup = await page.evaluate(() => {
    const testState = (
      window as unknown as {
        __turnstileTest: { widgets: Map<string, unknown>; removed: string[] };
      }
    ).__turnstileTest;
    return {
      active: testState.widgets.size,
      removed: testState.removed.length,
    };
  });
  expect(cleanup).toEqual({ active: 1, removed: 1 });
});

test("a verification error never enables sign-in", async ({ page }) => {
  await prepareTurnstile(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Complete test verification" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const testState = (
      window as unknown as {
        __turnstileTest: {
          widgets: Map<string, { options: { "error-callback": () => void } }>;
        };
      }
    ).__turnstileTest;
    testState.widgets.values().next().value!.options["error-callback"]();
  });
  await expect(page.getByRole("alert")).toContainText(
    "couldn’t complete the verification",
  );
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeDisabled();
});

test("a missing site key blocks sign-in and offers no automatic verification bypass", async ({
  page,
}) => {
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;export const supabase={auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};`,
    }),
  );
  await page.route("**/src/App.tsx*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replaceAll(
        "import.meta.env.VITE_TURNSTILE_SITE_KEY",
        '""',
      ),
    });
  });
  let scriptLoads = 0;
  await page.route("https://challenges.cloudflare.com/**", (route) => {
    scriptLoads++;
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Sign-in verification is not configured",
  );
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeDisabled();
  expect(scriptLoads).toBe(0);
});

test("requesting a branded sign-in uses only the app endpoint and retains the grant destination", async ({
  page,
}) => {
  await prepareTurnstile(page);
  const requests: unknown[] = [];
  const nativeOtp: string[] = [];
  await page.route("**/api/auth-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route("**/auth/v1/otp", (route) => {
    nativeOtp.push(route.request().url());
    return route.abort();
  });
  const org = "6a03978d-6266-46b6-b35e-bf8069e50743";
  const grant = "6a03978d-6266-46b6-b35e-bf8069e50744";
  await page.goto(`/?view=opportunities&org=${org}&grant=${grant}`);
  await page
    .getByRole("textbox", { name: "Your email address", exact: true })
    .fill("member@example.invalid");
  await page
    .getByRole("button", { name: "Complete test verification" })
    .click();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByText(
      "If this address can sign in, you’ll receive an email from Simple Grants.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(requests).toEqual([
    {
      email: "member@example.invalid",
      captchaToken: "test-verification-token",
      next: `/?view=opportunities&org=${org}&grant=${grant}`,
    },
  ]);
  expect(nativeOtp).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeDisabled();
});
