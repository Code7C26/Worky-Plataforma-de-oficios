import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import app from "../src/app";

test("las dos rutas móviles están montadas bajo /api/v1 y rechazan cuerpos vacíos", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    for (const action of ["request", "confirm"]) {
      // Invalid input must be rejected before looking up accounts or sending email.
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/auth/mobile-login/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      assert.equal(response.status, 400, `${action}: debe validar el cuerpo, no devolver 404`);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(typeof body.error, "string");
      assert.equal(body.token, undefined);
      assert.equal(body.usuario, undefined);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
