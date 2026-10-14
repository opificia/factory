// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

// Loads the repository's .env file before anything reads the environment.
// Variables that are already set win.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = process.env.OPIFICIA_ENV_FILE ?? fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
