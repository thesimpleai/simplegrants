import { test, expect } from "@playwright/test";
const userId = "6a03978d-6266-46b6-b35e-bf8069e50743";
const payload = {
  sub: userId,
  aud: "authenticated",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const token = [
  Buffer.from("{}").toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"),
  "test-signature",
].join(".");
for (const flow of ["implicit", "pkce"] as const) {
  test(`the real browser client does not automatically consume an unsolicited ${flow} callback`, async ({
    page,
  }) => {
    const authRequests: string[] = [];
    await page.route("**/src/lib/supabase.ts*", async (route) => {
      const response = await route.fetch();
      const body = (await response.text())
        .replaceAll(
          "import.meta.env.VITE_SUPABASE_URL",
          '"https://auth-test.supabase.co"',
        )
        .replaceAll(
          "import.meta.env.VITE_SUPABASE_ANON_KEY",
          '"public-test-key"',
        );
      await route.fulfill({ response, body });
    });
    await page.route(
      "https://auth-test.supabase.co/auth/v1/**",
      async (route) => {
        authRequests.push(route.request().url());
        await route.fulfill({
          json: {
            id: userId,
            email: "someone-else@example.invalid",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
          },
        });
      },
    );
    await page.route("https://auth-test.supabase.co/rest/v1/**", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        "simple-grants-auth-v1-auth-test.supabase.co-code-verifier",
        JSON.stringify("untrusted-test-code-verifier"),
      ),
    );
    const destination =
      flow === "implicit"
        ? "/#" +
          new URLSearchParams({
            access_token: token,
            refresh_token: "untrusted-refresh",
            expires_in: "3600",
            token_type: "bearer",
            type: "magiclink",
          })
        : "/?code=untrusted-authorization-code";
    await page.goto(destination);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "Let’s get you settled in." }),
    ).toBeVisible();
    expect(authRequests).toEqual([]);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("simple-grants-auth-v1-auth-test.supabase.co"),
      ),
    ).toBeNull();
  });
}
