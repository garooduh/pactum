// Optional browser QA: see README.md. All API traffic is mocked; production is never contacted.
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PACT_PLAYWRIGHT_MODULE || "playwright"
);
import fs from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const catalog = JSON.parse(
  await fs.readFile(root + "/backend/app/furniture_catalog.json", "utf8"),
);
const imageDir = root + "/backend/app/furniture_seed/";
const output = process.env.PACT_UI_OUTPUT || "/tmp/pact-furniture-ui";
await fs.mkdir(output, { recursive: true });
const upstream = new URL(process.env.PACT_UI_URL || "http://127.0.0.1:5173");
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname),
  "QA requires a local Vite server",
);
// Chromium may bypass request interception for download links. Serve that fixture
// over HTTP as well; forward assets only to the explicitly local Vite server.
const fixtureServer = http.createServer((req, res) => {
  if (req.url.startsWith("/api/furniture/issues/")) {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="furniture.pdf"',
    });
    res.end("test-document");
    return;
  }
  const proxy = http.request(
    new URL(req.url, upstream),
    { method: req.method, headers: { ...req.headers, host: upstream.host } },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502);
    res.end("Start the local Vite server before running QA");
  });
  req.pipe(proxy);
});
await new Promise((resolve, reject) => {
  fixtureServer.once("error", reject);
  fixtureServer.listen(0, "127.0.0.1", resolve);
});
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let lists = [],
    revision = 0,
    saves = [],
    saveDelay = 0,
    disconnect = false,
    conflict = false,
    failPdf = false,
    loadFailure = true;
  await page.context().route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    const fulfill = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/me") return fulfill({ ok: true });
    if (path === "/api/profile")
      return fulfill({
        profile: {
          party: { short_name: "Тестовая мастерская" },
          verified: true,
          revision: 0,
        },
        source_notes: [],
      });
    if (path === "/api/contracts") return fulfill([]);
    if (path.startsWith("/api/furniture/images/"))
      return route.fulfill({
        contentType: "image/png",
        body: await fs.readFile(imageDir + path.split("/").at(-1)),
      });
    if (path === "/api/furniture/catalog") {
      if (method === "GET") return fulfill({ id: "seed-v1", items: catalog });
      return fulfill(
        url.searchParams.has("preview")
          ? { count: 170, images: 170 }
          : { id: "new-catalog", items: catalog },
      );
    }
    if (path === "/api/furniture/lists") {
      if (method === "POST") {
        const x = {
          id: "list-" + (lists.length + 1),
          revision: 0,
          number: lists.length + 1,
          created_at: "2026-11-08T22:30:00+00:00",
          data: { title: "Список мебели", rooms: [], items: [] },
        };
        lists.push(x);
        return fulfill(x);
      }
      if (loadFailure)
        return fulfill({ detail: "Временный сбой загрузки" }, 500);
      return fulfill(lists);
    }
    if (path.endsWith("/generate"))
      return fulfill({
        id: "issue-test",
        status: failPdf ? "pdf_failed" : "ready",
      });
    if (path.startsWith("/api/furniture/issues/"))
      return route.fulfill({
        contentType: "application/octet-stream",
        headers: {
          "Content-Disposition": 'attachment; filename="furniture.docx"',
        },
        body: "test-document",
      });
    const id = path.split("/").at(-1),
      index = lists.findIndex((x) => x.id === id);
    if (method === "PUT") {
      if (disconnect) return route.abort("connectionrefused");
      if (conflict)
        return fulfill({ detail: "Список изменён. Откройте его заново." }, 409);
      const data = req.postDataJSON();
      if (saveDelay) await new Promise((r) => setTimeout(r, saveDelay));
      if (lists[index].revision !== data.revision)
        return fulfill({ detail: "Conflict" }, 409);
      saves.push(data);
      revision++;
      lists[index] = {
        ...lists[index],
        id,
        revision: lists[index].revision + 1,
        data: data.data,
      };
      return fulfill(lists[index]);
    }
    if (method === "DELETE") {
      lists.splice(index, 1);
      return fulfill({ ok: true });
    }
    return fulfill({ detail: "Unknown " + method + " " + path }, 404);
  });
  const shot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    return page.screenshot({
      path: `${output}/${name}.png`,
      fullPage: !name.includes("catalog"),
    });
  };
  const waitSave = () =>
    page.waitForFunction(() =>
      document
        .querySelector(".fur-save-status")
        ?.textContent?.includes("Сохранено"),
    );
  const noOverflow = async () =>
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "horizontal page overflow",
    );
  const room = () =>
    page.locator(".fur-room").filter({
      has: page.getByRole("heading", { name: "Кабинет 101", exact: true }),
    });
  const url = process.env.PACT_UI_URL || "http://127.0.0.1:5173";
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "QA requires a local Vite server",
  );
  await page.goto(`http://127.0.0.1:${fixtureServer.address().port}`);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Списки мебели" })
    .click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.getByRole("alert").waitFor();
  loadFailure = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  await page.getByText("Первый список — с чистого листа").waitFor();
  await shot("01-empty-index");
  await page
    .getByRole("button", { name: "Создать список мебели", exact: true })
    .click();
  await page.getByText("Список №1 · Создан 09.11.2026", { exact: true }).waitFor();
  await page
    .getByLabel("Название списка", { exact: true })
    .fill("Мебель для клиники «Север»");
  await shot("01b-empty-editor");
  await page
    .getByRole("button", { name: "Добавить кабинет", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Название кабинета", { exact: true })
    .fill("Кабинет 101");
  await page
    .getByRole("button", { name: "Создать кабинет", exact: true })
    .click();
  await room()
    .getByRole("button", { name: "Добавить мебель", exact: true })
    .click();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert(
      await page.evaluate(
        () => document.activeElement?.closest("dialog")?.open,
      ),
      "focus escaped catalog",
    );
  }
  await page.getByLabel("Найти мебель").fill("AR-01");
  await page
    .getByRole("button", { name: "Добавить", exact: true })
    .first()
    .click();
  await page.getByLabel("Найти мебель").fill("AR-02");
  await page
    .getByRole("button", { name: "Добавить", exact: true })
    .first()
    .click();
  await page.getByLabel("Найти мебель").fill("");
  await shot("02-catalog-desktop");
  await page.getByRole("button", { name: /^Готово/ }).click();
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("12000");
  await page
    .getByLabel("Количество AR-01, строка 1", { exact: true })
    .fill("2");
  await page.getByLabel("Цена AR-02, строка 2", { exact: true }).fill("8500");
  await waitSave();
  assert.equal(lists[0].data.items.length, 2);
  assert.equal(lists[0].data.items[0].room, "Кабинет 101");
  assert(
    (await page.locator(".fur-export-summary").innerText()).includes(
      "32 500,00",
    ),
  );
  await shot("03-editor-desktop");
  await noOverflow();
  await page.setViewportSize({ width: 1024, height: 900 });
  await shot("04-editor-tablet");
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("05-editor-mobile");
  await noOverflow();
  await room()
    .getByRole("button", { name: "Добавить мебель", exact: true })
    .click();
  await shot("06-catalog-mobile");
  await noOverflow();
  await page
    .getByRole("button", { name: "Подробнее о AR-01", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("heading", { name: "AR-01", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  // Rename the room without losing positions; cancel deletion explicitly.
  await page
    .getByLabel("Действия с кабинетом Кабинет 101", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Переименовать", exact: true })
    .click();
  await page
    .getByLabel("Название кабинета", { exact: true })
    .fill("Кабинет 102");
  await page
    .getByRole("button", { name: "Сохранить название", exact: true })
    .click();
  await waitSave();
  assert.equal(lists[0].data.items[0].room, "Кабинет 102");
  await page
    .getByLabel("Действия с кабинетом Кабинет 102", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Переименовать", exact: true })
    .click();
  await page
    .getByLabel("Название кабинета", { exact: true })
    .fill("Кабинет 101");
  await page
    .getByRole("button", { name: "Сохранить название", exact: true })
    .click();
  await waitSave();
  await page
    .getByLabel("Действия с кабинетом Кабинет 101", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить кабинет", exact: true })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  assert.equal(await page.locator("[data-furniture-row]").count(), 2);
  // Move to the general block without changing price or quantity.
  await page
    .getByLabel("Действия с позицией AR-01, строка 1", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Перенести в кабинет", exact: true })
    .click();
  await page.getByLabel("Куда перенести").selectOption("");
  await page.getByRole("button", { name: "Перенести", exact: true }).click();
  await waitSave();
  assert.equal(lists[0].data.items[0].room, "");
  // Inline validation, partial total, focus first error and prohibit generation.
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Укажите цены для 1 позиции" })
    .click();
  assert(
    await page
      .getByLabel("Цена AR-01, строка 1", { exact: true })
      .evaluate((el) => document.activeElement === el),
  );
  assert(
    await page
      .getByRole("button", { name: "Скачать PDF", exact: true })
      .isDisabled(),
  );
  assert(
    (await page.locator(".fur-export-summary").innerText()).includes(
      "8 500,00",
    ),
  );
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("12000");
  await waitSave();
  // Do not send invalid quantities; restore autosave after correction.
  const saveCount = saves.length;
  await page
    .getByLabel("Количество AR-01, строка 1", { exact: true })
    .fill("1.5");
  await page.waitForTimeout(1000);
  assert.equal(saves.length, saveCount);
  assert(
    (await page
      .getByLabel("Количество AR-01, строка 1", { exact: true })
      .getAttribute("aria-invalid")) === "true",
  );
  await page
    .getByLabel("Количество AR-01, строка 1", { exact: true })
    .fill("2");
  await waitSave();
  // Serialized requests must preserve edits made while a save is in flight.
  await page.setViewportSize({ width: 1440, height: 1050 });
  saveDelay = 1100;
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("100");
  await page.waitForTimeout(950);
  await page.getByLabel("Цена AR-02, строка 2", { exact: true }).fill("200");
  await waitSave();
  await page.waitForTimeout(1500);
  assert.equal(lists[0].data.items[1].price, "200");
  saveDelay = 0;
  // Network error and online retry.
  disconnect = true;
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("300");
  await page.waitForTimeout(1100);
  assert(
    (await page.locator(".fur-save-status").innerText()).includes(
      "Не сохранено",
    ),
  );
  disconnect = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSave();
  assert.equal(lists[0].data.items[0].price, "300");
  // Generation failure offers DOCX and retry; edits are retained.
  failPdf = true;
  await page.getByRole("button", { name: "Скачать PDF", exact: true }).click();
  await page
    .getByRole("button", { name: "Повторить PDF", exact: true })
    .waitFor();
  failPdf = false;
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Повторить PDF", exact: true })
    .click();
  const downloaded = await dl;
  assert.equal(await downloaded.failure(), null);
  assert.equal(
    await fs.readFile(await downloaded.path(), "utf8"),
    "test-document",
  );
  // Catalog replacement preview and nested modal focus restoration.
  await room()
    .getByRole("button", { name: "Добавить мебель", exact: true })
    .click();
  await page.getByLabel("Настройки каталога").click();
  await page
    .getByRole("button", { name: "Обновить из XLSX", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "catalog.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fixture"),
  });
  await page
    .getByRole("button", { name: "Проверить файл", exact: true })
    .click();
  await page
    .getByText("170 позиций · 170 изображений", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Заменить каталог", exact: true })
    .click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: /^Готово/ }).click();
  // Revision conflict blocks editing and reload is explicitly confirmed.
  conflict = true;
  await page.getByLabel("Цена AR-01, строка 1", { exact: true }).fill("999");
  await page.waitForTimeout(1100);
  assert(
    await page.getByLabel("Цена AR-01, строка 1", { exact: true }).isDisabled(),
  );
  await page
    .getByRole("button", { name: "Открыть сохранённую версию", exact: true })
    .click();
  await page
    .getByText(
      "Локальные несохранённые изменения будут заменены версией с сервера. Продолжить?",
      { exact: true },
    )
    .waitFor();
  conflict = false;
  await page
    .getByRole("button", { name: "Открыть версию с сервера", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page.getByLabel("Цена AR-01, строка 1", { exact: true }).inputValue(),
    "300",
  );
  await page.getByRole("button", { name: "Все списки", exact: true }).click();
  await shot("07-saved-index");
  await page.locator(".fur-project").getByText("Создан 09.11.2026", { exact: true }).waitFor();
  await page.getByLabel("Найти список").fill("№1");
  assert.equal(await page.locator(".fur-project").count(), 1);
  await page.getByLabel("Найти список").fill("№999");
  await page.getByText("Списки не найдены", { exact: true }).waitFor();
  await page.getByLabel("Найти список").fill("");
  await page.locator(".fur-project").first().click();
  await page.getByLabel("Действия со списком", { exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить список", exact: true })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  assert.equal(lists.length, 1);
  await page.getByLabel("Действия со списком", { exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить список", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await page
    .getByText("Первый список — с чистого листа", { exact: true })
    .waitFor();
  assert.equal(lists.length, 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: desktop/tablet/mobile, dialogs, catalog, rooms, amounts, validation, serialized autosave, network retry, revision conflict, import and PDF retry.",
  );
  console.log("Screenshots:", output);
} finally {
  await browser.close();
  fixtureServer.closeAllConnections();
  await new Promise((resolve) => fixtureServer.close(resolve));
}
