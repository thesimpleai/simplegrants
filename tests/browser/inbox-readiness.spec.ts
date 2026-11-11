import { expect, test } from "@playwright/test";
import { configureInbox } from "./inbox-fixture";

const configuredDomain = "intake.simplegrants.com.au";
const unavailable = [
  { name: "unset flag", enabled: undefined, domain: configuredDomain },
  {
    name: "explicitly disabled flag",
    enabled: "false",
    domain: configuredDomain,
  },
  { name: "non-exact flag", enabled: "TRUE", domain: configuredDomain },
  { name: "missing domain", enabled: "true", domain: undefined },
  {
    name: "URL instead of hostname",
    enabled: "true",
    domain: `https://${configuredDomain}`,
  },
  { name: "placeholder domain", enabled: "true", domain: "mail.example.com" },
  {
    name: "placeholder setting",
    enabled: "true",
    domain: "YOUR_VERIFIED_RECEIVING_DOMAIN",
  },
  {
    name: "hostname with port",
    enabled: "true",
    domain: `${configuredDomain}:587`,
  },
];

for (const setting of unavailable) {
  test(`${setting.name} hides forwarding and copy while preserving the inbox`, async ({
    page,
  }) => {
    await configureInbox(page, setting.enabled, setting.domain);
    await page.goto("/?view=inbox");
    await expect(
      page.getByRole("heading", { name: "Email intake is not ready yet." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Upload documents in the portal" }),
    ).toBeVisible();
    await expect(page.locator(".inbox-address")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Copy address" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Forward it. Find it here." }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("button")
        .filter({ hasText: "Photos from our first community lunch" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ask your assistant" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "mail.thesimpleai.com",
    );
  });
}

test("a confirmed hostname enables only its configured address and copy action", async ({
  page,
}) => {
  await configureInbox(page, "true", `  ${configuredDomain.toUpperCase()}  `);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copiedInbox: string }).copiedInbox = value;
        },
      },
    });
  });
  await page.goto("/?view=inbox");
  const address = `merri-demo@${configuredDomain}`;
  await expect(page.locator(".inbox-address")).toHaveText(address);
  await expect(
    page.getByRole("heading", { name: "Forward it. Find it here." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Email intake is not ready yet." }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { copiedInbox: string }).copiedInbox,
      ),
    )
    .toBe(address);
});

test("existing messages can be reviewed and portal uploads remain reachable before email is ready", async ({
  page,
}) => {
  await configureInbox(page, "false", undefined);
  await page.goto("/?view=inbox");
  const message = page
    .getByRole("button")
    .filter({ hasText: "Photos from our first community lunch" });
  await message.click();
  await expect(page.getByRole("dialog")).toContainText("28 neighbours");
  await page
    .getByRole("button", { name: "Mark as reviewed", exact: true })
    .click();
  await expect(message.getByText("Reviewed", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Upload documents in the portal" })
    .click();
  await expect(page).toHaveURL(/view=organisation/);
  await expect(
    page.getByRole("heading", {
      name: "A home for your organisation.",
      exact: true,
    }),
  ).toBeVisible();
});
