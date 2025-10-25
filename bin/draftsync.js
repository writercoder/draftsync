#!/usr/bin/env node

/**
 * draftsync CLI entry point
 *
 * This is the executable entry point for the draftsync CLI tool.
 * It simply imports and runs the main CLI module.
 */

import { run } from '../src/cli.js';

run();
