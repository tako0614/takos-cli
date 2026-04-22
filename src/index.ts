#!/usr/bin/env node

import process from "node:process";
import { runCli } from "./program.ts";

void runCli(process.argv);
