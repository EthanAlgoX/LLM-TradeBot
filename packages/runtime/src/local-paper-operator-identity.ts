import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Returns the single development operator credential for a local Paper
 * workspace. The secret is deliberately kept beside other ignored local
 * workspace state, never passed to Vite and never written to stdout.
 */
export function loadLocalPaperOperatorToken(directory: string): string {
  const path = join(directory, ".operator-identity");
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim();
    if (/^[a-f0-9]{64}$/u.test(token)) return token;
    throw new Error("Local Paper operator identity is invalid.");
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}
