import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { markNotificationRead } from "../src/lib/api";

const workyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

test("un fallo de red al abrir un aviso no cambia el aviso ni su contador", async () => {
  const notifications = [
    { id: 101, href: "/chat/42", leida: false },
    { id: 102, href: "/chat/84", leida: false },
    { id: 103, href: null, leida: true },
  ];
  const before = structuredClone(notifications);
  const unreadBefore = notifications.filter((item) => !item.leida).length;
  let confirmed = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };

  try {
    await assert.rejects(
      markNotificationRead(101, () => {
        confirmed = true;
        notifications.find((item) => item.id === 101)!.leida = true;
      }),
      /network unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(confirmed, false);
  assert.deepEqual(notifications, before);
  assert.equal(notifications.filter((item) => !item.leida).length, unreadBefore);
});
  test("el panel se cierra al tocar fuera y los avisos fallidos se pueden reintentar", async () => {
  const notifications = [
    { id: 101, titulo: "Nuevo mensaje", href: "/chat/42", leida: false },
    { id: 102, titulo: "Nueva propuesta", href: "/chat/84", leida: false },
  ];
  const unreadBefore = notifications.filter((item) => !item.leida).length;
  const requestIds: number[] = [];
  let notificationReadFailure: { id: number; title: string } | null = null;
  let attempt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const match = String(input).match(/\/notificaciones\/(\d+)\/leida$/);
    requestIds.push(Number(match?.[1]));
    attempt += 1;
    if (attempt === 1) throw new TypeError("network unavailable");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const openNotification = async (item: (typeof notifications)[number]) => {
    try {
      await markNotificationRead(item.id, () => {
        notifications.find((notification) => notification.id === item.id)!.leida = true;
      });
      notificationReadFailure = null;
    } catch {
      notificationReadFailure = { id: item.id, title: item.titulo };
    }
  };

  try {
    await openNotification(notifications[0]);

    assert.deepEqual(requestIds, [101]);
    assert.deepEqual(notificationReadFailure, {
      id: 101,
      title: "Nuevo mensaje",
    });
    assert.equal(
      `No pudimos marcar “${notificationReadFailure.title}” como leída. Revisá tu conexión.`,
      "No pudimos marcar “Nuevo mensaje” como leída. Revisá tu conexión.",
    );
    assert.equal(notifications[0].leida, false);
    assert.equal(notifications.filter((item) => !item.leida).length, unreadBefore);

    await openNotification({
      ...notifications[0],
      id: notificationReadFailure.id,
      titulo: notificationReadFailure.title,
    });

    assert.deepEqual(requestIds, [101, 101]);
    assert.equal(notifications[0].leida, true);
    assert.equal(notifications[1].leida, false);
    assert.equal(notificationReadFailure, null);
    assert.equal(notifications.filter((item) => !item.leida).length, unreadBefore - 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dos fallos simultáneos conservan cada aviso y cada reintento usa su propio ID", async () => {
  const notifications = [
    { id: 201, titulo: "Nuevo mensaje", href: "/chat/42", leida: false },
    { id: 202, titulo: "Nueva propuesta", href: "/chat/84", leida: false },
  ];
  const failures = new Map<number, { id: number; title: string }>();
  const requestIds: number[] = [];
  const pending = new Map<number, () => void>();
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const id = Number(String(input).match(/\/notificaciones\/(\d+)\/leida$/)?.[1]);
    requestIds.push(id);
    requestCount += 1;
    if (requestCount <= 2) throw new TypeError("network unavailable");
    return new Promise<Response>((resolve) => {
      pending.set(id, () => resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));
    });
  };

  const openNotification = async (item: (typeof notifications)[number]) => {
    try {
      await markNotificationRead(item.id, () => {
        notifications.find((notification) => notification.id === item.id)!.leida = true;
        failures.delete(item.id);
      });
    } catch {
      failures.set(item.id, { id: item.id, title: item.titulo });
    }
  };

  try {
    const first = openNotification(notifications[0]);
    const second = openNotification(notifications[1]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(requestIds, [201, 202]);

    await Promise.all([first, second]);
    assert.deepEqual([...failures.values()], [
      { id: 201, title: "Nuevo mensaje" },
      { id: 202, title: "Nueva propuesta" },
    ]);
    assert.equal(notifications[0].leida, false);
    assert.equal(notifications[1].leida, false);

    const retry = async (failure: { id: number; title: string }) => {
      await markNotificationRead(failure.id, () => {
        failures.delete(failure.id);
      });
    };
    const retryFirst = retry(failures.get(201)!);
    const retrySecond = retry(failures.get(202)!);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(requestIds, [201, 202, 201, 202]);
    pending.get(201)!();
    pending.get(202)!();
    await Promise.all([retryFirst, retrySecond]);
    assert.equal(failures.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("la interfaz apila dos avisos fallidos y quita solo el reintento confirmado", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", {
    url: "http://localhost/home",
  });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    history: globalThis.history,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
    dispatchEvent: globalThis.dispatchEvent,
  };
  const previousReplId = process.env.REPL_ID;
  delete process.env.REPL_ID;
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    localStorage: { configurable: true, value: dom.window.localStorage },
    location: { configurable: true, value: dom.window.location },
    history: { configurable: true, value: dom.window.history },
    addEventListener: { configurable: true, value: dom.window.addEventListener.bind(dom.window) },
    removeEventListener: { configurable: true, value: dom.window.removeEventListener.bind(dom.window) },
    dispatchEvent: { configurable: true, value: dom.window.dispatchEvent.bind(dom.window) },
  });

  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let cleanup = () => {};
  const notifications = [
    { id: 201, titulo: "Nuevo mensaje", detalle: "Tenés una respuesta.", leida: false, href: "/home" },
    { id: 202, titulo: "Nueva propuesta", detalle: "Recibiste una propuesta.", leida: false, href: "/home" },
  ];
  const requestIds: number[] = [];
  let failedReads = new Set([201, 202]);
  let notificationFetches = 0;
  const originalFetch = globalThis.fetch;
  dom.window.localStorage.setItem("worky-token", "test-token");
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ id: 1, nombre: "Ana Cliente", email: "ana@example.com", rol: "cliente" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes("/partner-profile/me")) {
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/notificaciones") && init?.method !== "PATCH") {
      notificationFetches += 1;
      return new Response(JSON.stringify({
        items: notifications,
        unread: notifications.filter((item) => !item.leida).length,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes("/profesionales")) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes("/trabajos/")) {
      return new Response(JSON.stringify({
        id: 42,
        categoria: "Otro",
        ubicacion: { direccionTexto: "CABA", zona: "CABA" },
        precioOfrecido: 1000,
        detalle: "Trabajo de prueba",
        estado: "publicada",
        clienteId: 1,
        profesionalId: null,
        cliente: { id: 1, nombre: "Ana Cliente" },
        profesional: null,
        createdAt: new Date().toISOString(),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes("/chats/")) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (init?.method === "PATCH") {
      const id = Number(path.match(/notificaciones\/(\d+)\/leida$/)?.[1]);
      requestIds.push(id);
      if (failedReads.has(id)) {
        failedReads.delete(id);
        throw new TypeError(`temporary failure for ${id}`);
      }
      const notification = notifications.find((item) => item.id === id);
      if (notification) notification.leida = true;
      return new Response(JSON.stringify({ ...notification, leida: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    vite = await createServer({
      root: workyRoot,
      configFile: path.join(workyRoot, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "custom",
    });
    const { cleanup: cleanupRenderedApp, fireEvent, render, screen, waitFor } =
      await import("@testing-library/react");
    cleanup = cleanupRenderedApp;
    const React = await import("react");
    Object.defineProperty(globalThis, "React", { configurable: true, value: React });
    const { default: App } = await vite.ssrLoadModule("/src/App.tsx");

    render(React.createElement(App));
    await waitFor(() => assert.ok(screen.getByTestId("button-notifications")));
    await waitFor(() => assert.equal(screen.getByTestId("notification-unread-count").textContent, "2"));

    fireEvent.click(screen.getByTestId("button-notifications"));
    await waitFor(() => assert.ok(screen.getByTestId("notification-201")));
    assert.equal(screen.getByTestId("button-notifications").getAttribute("aria-expanded"), "true");
    fireEvent.pointerDown(document.body);
    await waitFor(() => assert.equal(screen.queryByRole("region", { name: "Notificaciones" }), null));
    assert.equal(screen.getByTestId("button-notifications").getAttribute("aria-expanded"), "false");

    fireEvent.click(screen.getByTestId("button-notifications"));
    await waitFor(() => assert.ok(screen.getByTestId("notification-201")));
    fireEvent.pointerDown(screen.getByTestId("notification-201"));
    assert.ok(screen.getByRole("region", { name: "Notificaciones" }));
    fireEvent.click(screen.getByTestId("notification-201"));
    await waitFor(() => assert.ok(screen.getByTestId("notification-read-error-201")));

    fireEvent.click(screen.getByTestId("button-notifications"));
    await waitFor(() => assert.ok(screen.getByTestId("notification-202")));
    fireEvent.click(screen.getByTestId("notification-202"));
    await waitFor(() => {
      assert.ok(screen.getByTestId("notification-read-error-201"));
      assert.ok(screen.getByTestId("notification-read-error-202"));
    });

    assert.deepEqual(requestIds, [201, 202]);
    assert.match(screen.getByTestId("notification-read-error-201").textContent ?? "", /Nuevo mensaje/);
    assert.match(screen.getByTestId("notification-read-error-202").textContent ?? "", /Nueva propuesta/);

    fireEvent.click(screen.getByTestId("button-retry-notification-read-201"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(screen.queryByTestId("notification-read-error-201"), null);
    assert.ok(screen.getByTestId("notification-read-error-202"));
    await waitFor(() => assert.equal(screen.getByTestId("notification-unread-count").textContent, "1"));
    notifications[1].leida = true;
    dom.window.dispatchEvent(new dom.window.StorageEvent("storage", {
      key: "worky-notification-sync",
      newValue: JSON.stringify({ userId: 1, at: Date.now() }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(screen.queryByTestId("notification-unread-count"), null);
    assert.ok(screen.getByTestId("notification-read-error-202"));
    assert.deepEqual(requestIds, [201, 202, 201]);
  } finally {
    cleanup();
    await vite?.close();
    if (previousReplId === undefined) delete process.env.REPL_ID;
    else process.env.REPL_ID = previousReplId;
    globalThis.fetch = originalFetch;
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: previousGlobals.window },
      document: { configurable: true, value: previousGlobals.document },
      navigator: { configurable: true, value: previousGlobals.navigator },
      HTMLElement: { configurable: true, value: previousGlobals.HTMLElement },
      Event: { configurable: true, value: previousGlobals.Event },
      CustomEvent: { configurable: true, value: previousGlobals.CustomEvent },
      localStorage: { configurable: true, value: previousGlobals.localStorage },
      location: { configurable: true, value: previousGlobals.location },
      history: { configurable: true, value: previousGlobals.history },
      addEventListener: { configurable: true, value: previousGlobals.addEventListener },
      removeEventListener: { configurable: true, value: previousGlobals.removeEventListener },
      dispatchEvent: { configurable: true, value: previousGlobals.dispatchEvent },
    });
    dom.window.close();
  }
});
