#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const envFilePath = path.join(projectRoot, "src-tauri", ".env.local");

function parseEnvFile(text) {
  const entries = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const splitIndex = line.indexOf("=");
    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    entries[key] = value;
  }

  return entries;
}

function normalizeApiUrl(rawUrl) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions") || trimmed.endsWith("/responses")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/chat/completions`;
}

function getPromptFromArgs() {
  const argIndex = process.argv.findIndex((arg) => arg === "--prompt");

  if (argIndex >= 0 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }

  return "只回复 pong。";
}

async function loadConfig() {
  const envFromFile = await fs
    .readFile(envFilePath, "utf8")
    .then(parseEnvFile)
    .catch(() => ({}));

  return {
    apiUrl: process.env.MIMO_API_URL ?? envFromFile.MIMO_API_URL ?? "",
    apiKey: process.env.MIMO_API_KEY ?? envFromFile.MIMO_API_KEY ?? "",
    model: process.env.MIMO_MODEL ?? envFromFile.MIMO_MODEL ?? "mimo-v2.5",
  };
}

async function main() {
  const { apiUrl, apiKey, model } = await loadConfig();

  if (!apiUrl) {
    throw new Error("缺少 MIMO_API_URL");
  }

  if (!apiKey) {
    throw new Error("缺少 MIMO_API_KEY");
  }

  const url = normalizeApiUrl(apiUrl);
  const prompt = getPromptFromArgs();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  const bodyText = await response.text();
  let parsedBody = bodyText;

  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    // keep raw body
  }

  const result = {
    ok: response.ok,
    status: response.status,
    url,
    model,
    prompt,
    response: parsedBody,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        envFilePath,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
