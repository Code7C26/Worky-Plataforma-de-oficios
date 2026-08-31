import assert from "node:assert/strict";
import test from "node:test";

test("coordina el stream entre pestañas y rehidrata avisos sin reintentos inmediatos", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", { url: "http://localhost/home" });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    EventSource: globalThis.EventSource,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    history: globalThis.history,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
    dispatchEvent: globalThis.dispatchEvent,
  };
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

  type Listener = (event: Event | MessageEvent<string>) => void;
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    private listeners = new Map<string, Set<Listener>>();
    closeCount = 0;

    constructor(readonly url: string) {
      FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: Listener) {
      const listeners = this.listeners.get(type) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener) {
      this.listeners.get(type)?.delete(listener);
    }

    close() {
      this.closeCount += 1;
    }

    disconnect() {
      this.emit("error", new dom.window.Event("error"));
    }

    reconnect() {
      this.emit("open", new dom.window.Event("open"));
    }

    emit(type: string, event: Event | MessageEvent<string>) {
      this.listeners.get(type)?.forEach((listener) => listener(event));
    }
  }
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
  Object.defineProperty(dom.window, "EventSource", { configurable: true, value: FakeEventSource });

  const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
  const React = await import("react");
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  const { default: App, queryClient } = await import("../src/App");
  const notifications = [
    { id: 301, titulo: "Nuevo mensaje", detalle: "Tenés una respuesta.", leida: false, href: "/home" },
  ];
  const originalFetch = globalThis.fetch;
  dom.window.localStorage.setItem("worky-token", "test-token");
  dom.window.localStorage.setItem("worky-notification-stream-lease-7", JSON.stringify({
    userId: 7,
    owner: "other-tab",
    expiresAt: Date.now() + 60_000,
  }));
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ id: 7, nombre: "Sofía Cliente", email: "sofia@example.com", rol: "cliente" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path.includes("/partner-profile/me")) return new Response(null, { status: 204 });
    if (path.endsWith("/notificaciones")) {
      return new Response(JSON.stringify({ items: notifications, unread: notifications.filter((item) => !item.leida).length }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    render(React.createElement(App));
    await waitFor(() => assert.ok(screen.getByTestId("button-notifications")));
    await waitFor(() => assert.equal(screen.getByTestId("notification-unread-count").textContent, "1"));
    assert.equal(FakeEventSource.instances.length, 0);
    dom.window.localStorage.setItem("worky-notification-stream-lease-7", JSON.stringify({
      userId: 7,
      owner: "other-tab",
      expiresAt: Date.now() - 1,
    }));
    await waitFor(() => assert.equal(FakeEventSource.instances.length, 1), { timeout: 2_000 });
    const stream = FakeEventSource.instances[0];
    assert.ok(stream);

    stream.disconnect();
    assert.equal(stream.closeCount, 1);
    assert.equal(FakeEventSource.instances.length, 1);
    notifications.unshift({ id: 302, titulo: "Nueva propuesta", detalle: "Recibiste una propuesta.", leida: false, href: "/home" });
    stream.reconnect();
    await waitFor(() => assert.equal(screen.getByTestId("notification-unread-count").textContent, "2"));

    stream.emit("notification", new dom.window.MessageEvent("notification", { data: JSON.stringify(notifications[0]) }));
    fireEvent.click(screen.getByTestId("button-notifications"));
    await waitFor(() => {
      assert.equal(screen.getAllByTestId("notification-301").length, 1);
      assert.equal(screen.getAllByTestId("notification-302").length, 1);
    });
    assert.equal(screen.getByTestId("notification-unread-count").textContent, "2");
  } finally {
    cleanup();
    queryClient.clear();
    globalThis.fetch = originalFetch;
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: previous.window },
      document: { configurable: true, value: previous.document },
      navigator: { configurable: true, value: previous.navigator },
      HTMLElement: { configurable: true, value: previous.HTMLElement },
      Event: { configurable: true, value: previous.Event },
      CustomEvent: { configurable: true, value: previous.CustomEvent },
      EventSource: { configurable: true, value: previous.EventSource },
      localStorage: { configurable: true, value: previous.localStorage },
      location: { configurable: true, value: previous.location },
      history: { configurable: true, value: previous.history },
      addEventListener: { configurable: true, value: previous.addEventListener },
      removeEventListener: { configurable: true, value: previous.removeEventListener },
      dispatchEvent: { configurable: true, value: previous.dispatchEvent },
    });
    dom.window.close();
  }
});