import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "release/mac-arm64/SQL Client.app");
const server = path.join(app, "Contents/Resources/sql-client-server");
const dmg = path.join(root, "release/sql-client-arm64.dmg");

if (!existsSync(app)) {
  throw new Error(`missing app bundle: ${app}`);
}

function sign(target: string): void {
  execFileSync("codesign", ["--force", "--sign", "-", target], { stdio: "inherit" });
}

sign(server);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });

if (existsSync(dmg)) rmSync(dmg);
execFileSync(
  "hdiutil",
  ["create", "-volname", "SQL Client", "-srcfolder", app, "-ov", "-format", "ULFO", dmg],
  { stdio: "inherit" },
);
