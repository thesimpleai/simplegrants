import { test, expect } from "@playwright/test";
import { configureInbox } from "./inbox-fixture";
test("overview, search, saved grants and source-gated application", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "A little clarity. A lot of possibility.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Explore your opportunities" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Grant opportunities", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search grant opportunities" })
    .fill("Stronger");
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Explore this grant" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "illustrative opportunity",
  );
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your applications" }),
  ).toBeVisible();
  await page
    .locator(".application-row")
    .filter({ hasText: "Stronger Neighbourhoods Fund" })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("multi-organisation create and switch isolates demo records", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".org-switch").click();
  await page
    .getByRole("button", { name: "Add an organisation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Organisation name", exact: true })
    .fill("New Neighbourhood Charity");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.locator(".org-switch")).toContainText(
    "New Neighbourhood Charity",
  );
  await page
    .getByRole("button", { name: "Grant opportunities", exact: true })
    .click();
  await expect(page.locator(".grant-card")).toHaveCount(0);
  await page.locator(".org-switch").click();
  await page
    .getByRole("button", { name: "Merri Community House", exact: true })
    .click();
  await expect(page.locator(".grant-card")).toHaveCount(4);
});
test("funded project ledger and milestone changes", async ({ page }) => {
  await page.goto("/?view=projects");
  await page.getByRole("button", { name: "View project" }).click();
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "What was the expense for?" })
    .fill("Workshop materials");
  await page
    .getByRole("spinbutton", { name: "Amount paid (AUD)" })
    .fill("125.50");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(
    page.getByRole("cell", { name: "Workshop materials" }),
  ).toBeVisible();
  const milestone = page.getByRole("button", {
    name: "Complete milestone: Mid-program progress report",
  });
  await milestone.click();
  await expect(
    page.getByRole("button", {
      name: "Mark incomplete: Mid-program progress report",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("award becomes a funded project", async ({ page }) => {
  await page.goto("/?view=applications");
  await page.locator(".application-row").first().click();
  await page
    .getByRole("combobox", { name: "Application status", exact: true })
    .selectOption("awarded");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Amount awarded (AUD)" })
    .fill("8500");
  await page.getByLabel("Project ends", { exact: true }).fill("2027-12-31");
  await page
    .getByRole("button", { name: "Create funded project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Funded & running", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Community kitchen & connection",
      exact: true,
    }),
  ).toBeVisible();
});
test("email inbox is reviewable and demo AI never pretends to run", async ({
  page,
}) => {
  await configureInbox(page, "false");
  await page.goto("/?view=inbox");
  await expect(
    page.getByRole("heading", { name: "Email intake is not ready yet." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy address" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button")
    .filter({ hasText: "Photos from our first community lunch" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("28 neighbours");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Grant opportunities", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "AI is not connected in the demo",
  );
});
test("small screens do not overflow and navigation opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "My organisation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A home for your organisation.",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
