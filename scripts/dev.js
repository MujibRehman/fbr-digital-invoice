import { spawn } from "node:child_process";
// Serve the built UI and API from one origin so the production CSRF policy stays intact.
const children = [
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--watch"],
    { stdio: "inherit" },
  ),
  spawn(process.execPath, ["--watch", "src/server.js"], { stdio: "inherit" }),
];
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopped) {
      process.exitCode = code || 0;
      stop();
    }
  });
