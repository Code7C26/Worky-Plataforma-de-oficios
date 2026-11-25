import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Start the web workflow first, or provide WORKY_ADMIN_QA_URL.
// All API requests are intercepted; this test never modifies a real account.
const baseUrl = process.env.WORKY_ADMIN_QA_URL || "http://127.0.0.1:22943";

test("habilitar el último Partner conserva el diseño y actualiza el contador", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 600 }]) {
      const page = await browser.newPage({ viewport });
      let enabled = false;
      let activationRequests = 0;
      const user = { id: 42, nombre: "Admin QA", email: "admin@example.test", rol: "admin" };
      const partner = {
        id: 7, userId: 7, name: "Partner QA", email: "partner@example.test",
        trade: "Electricista", category: "Electricidad", accountActive: true,
        enabled: false, verified: true, verificationStatus: "verified", documents: [],
      };
      const documents = ["dni_frente", "dni_dorso", "antecedentes_penales"].map((tipo, index) => ({
        id: index + 1, tipo, estado: "verified", nombre: `${tipo}.png`,
        objectPath: `/objects/qa/${index}`, contentType: "image/png",
        sizeBytes: 2048, createdAt: "2026-01-01T12:00:00Z",
        partner: { id: 7, nombre: partner.name },
      }));
      const application = {
        partner, documents, emailVerifiedAt: "2026-01-01T12:00:00Z",
        matriculaHabilitante: null,
      };
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("worky-token", "admin-layout-qa-token");
        localStorage.setItem("worky-role", "client");
      });
      await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body = {};
        if (path.endsWith("/auth/me")) body = user;
        else if (path.endsWith("/admin/dashboard")) body = { partnersPendingReview: enabled ? 0 : 1 };
        else if (path.endsWith("/admin/partner-applications")) {
          body = { items: enabled ? [] : [application], total: enabled ? 0 : 1, page: 1, limit: 20 };
        } else if (path.endsWith("/admin/partners/7/activation")) {
          assert.equal(route.request().method(), "PATCH");
          assert.equal(route.request().postDataJSON().enabled, true);
          assert.equal(route.request().postDataJSON().reason, "Documentación revisada en QA");
          activationRequests += 1;
          enabled = true;
          body = { ...partner, enabled: true };
        } else if (path.includes("/notificaciones")) body = { items: [], unread: 0 };
        else if (path.includes("/conversaciones")) body = [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      try {
        await page.goto(`${baseUrl}/admin/verificaciones`);
        await page.getByTestId("card-application-7").waitFor();
        await page.getByTestId("badge-admin-pending-review").waitFor({ state: "attached" });
        await page.getByTestId("button-enable-application-7").click();
        await page.getByTestId("input-admin-reason").fill("Documentación revisada en QA");
        await page.getByTestId("button-confirm-reason").click();
        await page.getByTestId("card-application-7").waitFor({ state: "detached" });
        await page.getByTestId("badge-admin-pending-review").waitFor({ state: "detached" });
        await page.getByText("Partner habilitado oficialmente.", { exact: true }).waitFor();
        assert.equal(activationRequests, 1);
        assert.equal(await page.getByTestId("dialog-reason").count(), 0);
        assert.equal(await page.getByText("0 perfiles sin habilitar", { exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        const main = await page.getByTestId("admin-main").boundingBox();
        assert.ok(main.y >= 0 && main.y + main.height <= viewport.height + 1);
        if (viewport.width < 640) await page.getByTestId("button-mobile-nav").click();
        const sidebar = page.getByTestId("admin-sidebar");
        assert.equal(await sidebar.evaluate((el) => getComputedStyle(el).overflowY), "auto");
        await page.getByTestId("nav-admin-admins").focus();
        const bounds = await sidebar.boundingBox();
        const lastItem = await page.getByTestId("nav-admin-admins").boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
        assert.ok(lastItem.y >= bounds.y && lastItem.y + lastItem.height <= bounds.y + bounds.height + 1);
        if (process.env.WORKY_ADMIN_LAYOUT_SCREENSHOTS) {
          await mkdir(process.env.WORKY_ADMIN_LAYOUT_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: `${process.env.WORKY_ADMIN_LAYOUT_SCREENSHOTS}/admin-after-enable-${viewport.width}.png` });
        }
        console.log(`PASS Admin ${viewport.width}x${viewport.height}: cola vacía, contador actualizado y menú accesible`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
