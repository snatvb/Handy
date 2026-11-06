import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("Fixture error:", error));
  await page.goto("/tests/fixtures/replacements.html");
  await page.getByRole("button", { name: "Replacements", exact: true }).click();
});

test("separate tab preserves existing replacements and edits in their own card", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Replacements", exact: true }),
  ).toBeVisible();
  await expect(page.locator("details")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Replace with" })).toHaveValue(
    "JSX",
  );
  await page.getByRole("textbox", { name: "Replace with" }).fill("TSX");
  await page
    .getByRole("textbox", { name: "Recognition variants" })
    .fill("pending variant");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit TSX", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("pending variant", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Replacements", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit TSX", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("сонат", { exact: true })).toBeVisible();
});

test("tag editing, Enter, paste, removal, and cancellation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  const aliases = page.getByRole("textbox", { name: "Recognition variants" });
  await aliases.fill("new tag");
  await aliases.press("Enter");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove variant new tag", exact: true }),
  ).toBeVisible();
  await aliases.evaluate((input) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "gsx, other\nOTHER\nthird");
    input.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Remove variant other", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove variant GSX", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Replace with" })).toHaveCount(
    0,
  );
  await expect(page.getByText("GSX", { exact: true })).toBeVisible();
  await expect(page.getByText("new tag", { exact: true })).toHaveCount(0);
});

test("add, duplicate validation, length validation, and delete", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Add replacement", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("jsx");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page
    .getByRole("textbox", { name: "Replace with" })
    .fill("x".repeat(51));
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page.getByRole("textbox", { name: "Replace with" }).fill("worktree");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit worktree", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove worktree", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit worktree", exact: true }),
  ).toHaveCount(0);
});

test("failed saves keep draft and existing entry", async ({ page }) => {
  await page.goto("/tests/fixtures/replacements.html?fail=1");
  await page.getByRole("button", { name: "Replacements", exact: true }).click();
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("TSX");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByRole("textbox", { name: "Replace with" })).toHaveValue(
    "TSX",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit JSX", exact: true }),
  ).toBeVisible();
});

test("Russian sidebar and editor labels", async ({ page }) => {
  await page.goto("/tests/fixtures/replacements.html?lang=ru");
  await page.getByRole("button", { name: "Замены", exact: true }).click();
  await page.getByRole("button", { name: "Изменить JSX", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Заменять на" })).toHaveValue(
    "JSX",
  );
});

test("closing editor restores keyboard focus to its card or Add button", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  await page.getByRole("textbox", { name: "Replace with" }).press("Escape");
  await expect(
    page.getByRole("button", { name: "Edit JSX", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("TSX");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit TSX", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Add replacement", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add replacement", exact: true }),
  ).toBeFocused();
});

test("pending save locks controls and failed save restores entry without losing draft", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/replacements.html?slow=1&fail=1");
  await page.getByRole("button", { name: "Replacements", exact: true }).click();
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  const word = page.getByRole("textbox", { name: "Replace with" });
  await word.fill("TSX");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(word).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit Sonnet", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { finishSave: () => void }).finishSave(),
  );
  await expect(word).toBeEnabled();
  await expect(word).toHaveValue("TSX");
  await expect(page.getByRole("alert")).toContainText("Could not save");
});

test("failed deletion restores replacement", async ({ page }) => {
  await page.goto("/tests/fixtures/replacements.html?slow=1&fail=1");
  await page.getByRole("button", { name: "Replacements", exact: true }).click();
  await page.getByRole("button", { name: "Remove JSX", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit JSX", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { finishSave: () => void }).finishSave(),
  );
  await expect(
    page.getByRole("button", { name: "Edit JSX", exact: true }),
  ).toBeVisible();
});

test("IME Enter and Escape do not commit variants or close editor", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Edit JSX", exact: true }).click();
  const aliases = page.getByRole("textbox", { name: "Recognition variants" });
  await aliases.fill("composition");
  await aliases.dispatchEvent("keydown", {
    key: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  await expect(
    page.getByRole("button", {
      name: "Remove variant composition",
      exact: true,
    }),
  ).toHaveCount(0);
  await aliases.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(aliases).toHaveValue("composition");
  await aliases.press(",");
  await expect(
    page.getByRole("button", {
      name: "Remove variant composition",
      exact: true,
    }),
  ).toBeVisible();
});

test("minimum window width has no horizontal overflow in dark editor", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.goto("/tests/fixtures/replacements.html?lang=ru");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "Замены", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("replacements-dark.png") });
  await page.getByRole("button", { name: "Изменить JSX", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Заменять на" }),
  ).toBeFocused();
  expect(
    await page
      .locator("main")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("replacements-editor-dark.png"),
  });
});
