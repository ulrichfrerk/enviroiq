// Builds the AWS artefacts consumed by template.yaml. Run from the repo root:
//   node artifacts/api-server/scripts/build-aws.mjs
//   dist/aws/handlers.mjs  bundled Lambda handlers (src/aws/handlers.ts)
//   dist/aws/node_modules  externals installed for linux/x64 (Lambda Chromium is x86_64 only)
//   dist/aws/migrations    SQL applied by the migrate handler
//   dist/public/           marketing site at /, the app at /app/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);
const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(api, "../..");
const outDir = path.join(root, "dist/aws");
const publicDir = path.join(root, "dist/public");

// Packages installed next to the bundle instead of inlined.
const RUNTIME_EXTERNALS = ["puppeteer-core", "@sparticuz/chromium", "pdf-parse", "nodemailer"];

async function buildFrontends() {
  await rm(publicDir, { recursive: true, force: true });
  const run = (filter, env) =>
    execFileSync("pnpm", ["--filter", filter, "run", "build"], {
      cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", PORT: "3000", ...env },
    });
  run("@workspace/marketing", { BASE_PATH: "/" });
  run("@workspace/enviroiq", { BASE_PATH: "/app/" });
  await mkdir(publicDir, { recursive: true });
  await cp(path.join(root, "artifacts/marketing/dist/public"), publicDir, { recursive: true });
  await cp(path.join(root, "artifacts/enviroiq/dist/public"), path.join(publicDir, "app"), { recursive: true });
}

async function buildLambda() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await esbuild({
    entryPoints: [path.join(api, "src/aws/handlers.ts")],
    platform: "node",
    target: "node24",
    bundle: true,
    format: "esm",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: true,
    minify: false,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
    external: [...RUNTIME_EXTERNALS, "puppeteer", "@aws-sdk/*", "*.node"],
    plugins: [esbuildPluginPino({ transports: [] })],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
    },
  });
  await cp(path.join(api, "migrations"), path.join(outDir, "migrations"), { recursive: true });
  await cp(path.join(api, "certs/rds-global-bundle.pem"), path.join(outDir, "rds-global-bundle.pem"));

  const apiPkg = JSON.parse(await readFile(path.join(api, "package.json"), "utf-8"));
  const deps = {};
  for (const name of RUNTIME_EXTERNALS) {
    const v = apiPkg.dependencies?.[name] ?? apiPkg.devDependencies?.[name];
    if (!v) throw new Error(`External dependency ${name} is not declared in artifacts/api-server/package.json`);
    deps[name] = v;
  }
  await writeFile(path.join(outDir, "package.json"), JSON.stringify({ name: "enviroiq-lambda", private: true, type: "module", dependencies: deps }, null, 2));
  console.log("installing externals for linux/x64...");
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", "--os=linux", "--cpu=x64", "--libc=glibc"], { cwd: outDir, stdio: "inherit" });
  console.log("lambda artefact ready in dist/aws");
}

if (process.env.SKIP_CLIENT_BUILD !== "1") await buildFrontends();
await buildLambda();
