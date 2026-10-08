import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const output = await mkdtemp(path.join(testDir, ".admin-signup-test-"));
try {
  await build({
    entryPoints: [path.join(testDir, "worky-admin-signup-routes.test.ts")],
    outfile: path.join(output, "tests.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["@electric-sql/pglite", "drizzle-orm", "drizzle-orm/*", "express", "express-rate-limit", "bcryptjs", "jsonwebtoken"],
    plugins: [{
      name: "isolate-admin-signup",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.join(testDir, "support/admin-signup-db.ts"),
        }));
        build.onResolve({ filter: /\/lib\/worky-email$/ }, () => ({
          path: path.join(testDir, "support/admin-signup-email.ts"),
        }));
        // Unrelated storage/email helpers are deliberately unavailable in these tests.
        build.onResolve({ filter: /^(?:\.\.\/lib\/(?:storage|email-verification|password-recovery)|\.\/storage)$/ }, (args) => ({
          path: args.path, namespace: "forbidden-side-effect",
        }));
        build.onLoad({ filter: /.*/, namespace: "forbidden-side-effect" }, () => ({
          contents: `
            const forbidden = () => { throw new Error("Unrelated side effect in isolated admin signup test"); };
            export const deleteObject = forbidden, isProfilePhotoSourcePath = forbidden,
              isValidImageObject = forbidden, processProfilePhoto = forbidden,
              cleanupRejectedChatAttachment = forbidden, createPasswordRecovery = forbidden,
              isPasswordRecoveryTokenValid = forbidden, passwordRecoveryTokenHash = forbidden,
              confirmEmailVerificationCode = forbidden, createEmailVerificationChallenge = forbidden,
              emailVerificationFailureDetails = forbidden;
          `,
          loader: "js",
        }));
      },
    }],
  });
  const result = spawnSync(process.execPath, ["--test", path.join(output, "tests.cjs")], {
    stdio: "inherit",
    // Fixed test secrets, no inherited production credentials or database URL.
    env: { PATH: process.env.PATH, NODE_ENV: "test", JWT_SECRET: "isolated-admin-signup-test-secret" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
