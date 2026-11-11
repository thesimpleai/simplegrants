import { expect, type Page } from "@playwright/test";

/** Isolate build-time public settings in the local Vite module; never send email. */
export async function configureInbox(
  page: Page,
  enabled?: string,
  domain?: string,
) {
  await page.route("**/src/pages/InboxPage.tsx*", async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    for (const [name, value] of [
      ["VITE_INBOUND_EMAIL_ENABLED", enabled],
      ["VITE_INBOUND_EMAIL_DOMAIN", domain],
    ] as const) {
      const reference = `import.meta.env.${name}`;
      expect(
        source,
        `Vite must expose the ${name} reference to the fixture`,
      ).toContain(reference);
      source = source.replaceAll(
        reference,
        value === undefined ? "undefined" : JSON.stringify(value),
      );
    }
    await route.fulfill({ response, body: source });
  });
}
