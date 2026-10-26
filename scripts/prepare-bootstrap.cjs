#!/usr/bin/env node
'use strict';
// Transmit the pinned fork's bootstrap byte for byte, including its START API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const bytes = fs.readFileSync(path.join(root, 'vendor/ns2jb/bootstrap.bas'));
if (!bytes.toString('utf8').includes('COMMON DEF START(PORT,A,B,C,D)\n'))
  throw Error('Expected the fork bootstrap with five START arguments.');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const target = path.join(root, 'assets/bootstrap.bas');
const checksum = digest + '  assets/bootstrap.bas\n';
if (process.argv.length === 3 && process.argv[2] === '--check') {
  if (!fs.readFileSync(target).equals(bytes) || fs.readFileSync(target + '.sha256', 'utf8') !== checksum)
    throw Error('Bootstrap asset does not match the pinned fork. Run node scripts/prepare-bootstrap.cjs.');
  console.log('Exact fork bootstrap verified (five START arguments).');
} else if (process.argv.length === 2) {
  fs.writeFileSync(target, bytes);
  fs.writeFileSync(target + '.sha256', checksum);
  console.log('Copied the fork bootstrap unchanged (five START arguments).');
} else throw Error('Usage: node scripts/prepare-bootstrap.cjs [--check]');
