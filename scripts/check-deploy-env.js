import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { readConfig } from "../src/config/env.js";
const sandbox = parse(readFileSync(".env.sandbox")),
  production = parse(readFileSync(".env.production"));
readConfig(sandbox);
readConfig(production);
if (sandbox.APP_ENV !== "sandbox" || production.APP_ENV !== "production")
  throw new Error("Incorrect environment file assignments");
for (const key of ["SESSION_SECRET", "DATABASE_URL"])
  if (sandbox[key] === production[key])
    throw new Error(`Environments must have different ${key}`);
for (const a of ["FBR_GET_TOKEN", "FBR_POST_TOKEN"])
  for (const b of ["FBR_GET_TOKEN", "FBR_POST_TOKEN"])
    if (sandbox[a] === production[b])
      throw new Error("FBR credentials must not be reused across environments");
if (sandbox.APP_URL === production.APP_URL)
  throw new Error("Use separate origins");
console.log(
  "Deployment environments are consistent and use separate configured credentials",
);
