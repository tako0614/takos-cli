#!/usr/bin/env bun

// Bun migration: install the Deno runtime compat global before anything else so
// `Deno.*` call sites work in `bun run` and in `bun build --compile` binaries
// (which do not load bunfig [run].preload). Side-effect import; must stay first.
import "../shims/deno-compat.ts";
import process from "node:process";
import { runCli } from "./program.ts";

void runCli(process.argv);
