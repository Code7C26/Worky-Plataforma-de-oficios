import assert from "node:assert/strict";
import { test } from "node:test";
import { completeAdminSignup, requestAdminSignupCode } from "../src/lib/api";

function installBrowserMocks(
  t: Parameters<Parameters<typeof test>[1]>[0],
  responder: (url: string, init?: RequestInit) => Response,
) {
  const values = new Map<string, string>();
  const previousFetch = globalThis.fetch;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return responder(String(input), init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  });
  return values;
}

test("admin code request calls the public API endpoint without sending a code in the request body", async (t) => {
  const values = installBrowserMocks(t, (url, init) => {
    assert.equal(url, "/api/v1/auth/admin-signup/request");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "admin@example.test" });
    return new Response(JSON.stringify({ message: "If enabled, check your email." }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  });
  values.set("worky-token", "existing-session");

  await requestAdminSignupCode("admin@example.test");
});

test("admin signup stores the authenticated Bearer token only after the server confirms admin role", async (t) => {
  const values = installBrowserMocks(t, (url, init) => {
    assert.equal(url, "/api/v1/auth/admin-signup/complete");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer existing-session");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      nombre: "Test Admin",
      email: "admin@example.test",
      password: "current-password",
      codigo: "123456",
    });
    return new Response(JSON.stringify({
      token: "new-admin-session",
      usuario: { id: 7, nombre: "Test Admin", email: "admin@example.test", rol: "admin" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  values.set("worky-token", "existing-session");

  const user = await completeAdminSignup({
    nombre: "Test Admin",
    email: "admin@example.test",
    password: "current-password",
    codigo: "123456",
  });

  assert.equal(user.rol, "admin");
  assert.equal(values.get("worky-token"), "new-admin-session");
});
