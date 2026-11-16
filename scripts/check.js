import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(dir) {
  const files = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.isDirectory()) files.push(...(await walk(`${dir}/${f.name}`)));
    else if (f.name.endsWith(".js")) files.push(`${dir}/${f.name}`);
  }
  return files;
}
for (const file of (
  await Promise.all(["src", "scripts", "frontend", "test"].map(walk))
).flat()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status) process.exit(result.status);
}
console.log("JavaScript syntax checks passed");
