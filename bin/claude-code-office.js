#!/usr/bin/env node
'use strict';
// `npx claude-code-office` entry point: starts the local server and opens the browser.
const argv = process.argv.slice(2);
if (!argv.includes('--open') && !argv.includes('--no-open')) argv.push('--open');
require('../server.js').cli(argv.filter(a => a !== '--no-open'));
