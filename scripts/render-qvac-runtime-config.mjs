#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "qvac.config.json");
const outputPath = path.join(projectRoot, ".local", "qvac.runtime.config.json");
const alias = "sourcetruce-extractor";

const config = JSON.parse(await readFile(sourcePath, "utf8"));
const model = config?.serve?.models?.[alias];
if (!model || typeof model.src !== "string" || model.type !== "llamacpp-completion") {
  throw new TypeError(`qvac.config.json is missing the explicit ${alias} GGUF model`);
}
if (typeof config.cacheDirectory !== "string") {
  throw new TypeError("qvac.config.json is missing cacheDirectory");
}

model.src = path.resolve(projectRoot, model.src);
config.cacheDirectory = path.resolve(projectRoot, config.cacheDirectory);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
