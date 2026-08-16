#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const projectRoot = values.get("--project-root");
const logPath = values.get("--log");
if (!projectRoot || !logPath) throw new TypeError("Usage: node capture-qvac-serve.mjs --project-root <path> --log <path>");
await mkdir(path.dirname(path.resolve(logPath)), { recursive: true });
const log = createWriteStream(path.resolve(logPath), { flags: "a" });
const child = spawn("npm", ["run", "qvac:serve"], { cwd: path.resolve(projectRoot), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) {
  stream.pipe(log, { end: false });
  stream.pipe(stream === child.stdout ? process.stdout : process.stderr);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("exit", (code, signal) => {
  log.end(() => process.exitCode = code ?? (signal ? 1 : 0));
});
