import { spawn, type ChildProcess } from "node:child_process";

const token = process.env.SQLC_TOKEN || "dev";
const addr = process.env.SQLC_ADDR || "127.0.0.1:53124";
const env = {
  ...process.env,
  SQLC_TOKEN: token,
  SQLC_ADDR: addr,
  VITE_API_ORIGIN: `http://${addr}`,
  VITE_API_TOKEN: token,
};

const go: ChildProcess = spawn("go", ["run", "./cmd/server"], { env, stdio: "inherit" });
const web: ChildProcess = spawn("npm", ["run", "dev"], { cwd: "web", env, stdio: "inherit" });

function stop(): void {
  go.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
go.on("exit", (code) => {
  web.kill();
  process.exit(code ?? 0);
});
