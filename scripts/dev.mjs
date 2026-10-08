import { spawn } from "node:child_process";

const webEnv = { ...process.env };
const web = spawn("npm", ["run", "dev"], { cwd: "web", env: webEnv, stdio: "inherit" });
const electron = spawn("npx", ["electron", "."], {
  env: { ...process.env, SQLC_WEB: "http://127.0.0.1:5173" },
  stdio: "inherit",
});

function stop() {
  electron.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  web.kill();
  process.exit(code ?? 0);
});
