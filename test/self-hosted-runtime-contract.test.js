'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'deploy/debian/sms-v3.service'), 'utf8');
const nginx = fs.readFileSync(path.join(root, 'deploy/debian/nginx-sms-v3.conf.example'), 'utf8');
const releaseTool = fs.readFileSync(path.join(root, 'scripts/self-hosted-release.js'), 'utf8');

test('Debian runtime uses the paired backend and frontend artifact paths', () => {
  assert.match(service, /^WorkingDirectory=\/opt\/sms-v3\/app\/backend$/m);
  assert.match(service, /^ExecStart=\/usr\/bin\/node \/opt\/sms-v3\/app\/backend\/src\/server\.js$/m);
  assert.match(nginx, /^    root \/var\/www\/sms\/frontend\/dist;$/m);
});

test('cutover contract requires both targets to be symlinks to one shared pointer', () => {
  assert.match(releaseTool, /runtimeIntegration\(app, web, pointer\)/);
  assert.match(releaseTool, /\['backend', app\], \['frontend', web\]/);
  assert.match(releaseTool, /must point to shared pointer/);
  assert.match(releaseTool, /fs\.lstatSync\(pointer\)\.isSymbolicLink\(\)/);
});

test('deployment templates do not retain the split legacy runtime layout', () => {
  assert.doesNotMatch(service, /\/opt\/sms-v3\/app\/src\/server\.js/);
  assert.doesNotMatch(nginx, /^    root \/var\/www\/sms;$/m);
  assert.match(releaseTool, /args\.pointer \|\| '\/srv\/sms-v3\/.current'/);
});

test('boundary containment accepts the filesystem root as an ancestor', () => {
  const { contained } = require('../scripts/self-hosted-release');
  assert.equal(contained('/', '/srv/sms-v3/releases/sms-v3-x'), true);
  assert.equal(contained('/srv', '/srv/sms-v3'), true);
  assert.equal(contained('/srv', '/srv'), true);
  assert.equal(contained('/srv', '/srvx/sms-v3'), false);
  assert.equal(contained('/srv/sms-v3', '/srv'), false);
  assert.equal(contained('/srv/a', '/srv/a/..b'), true);
});

test('default parent traversal reaches the filesystem root without a boundary error', () => {
  const { validateParentTraversal } = require('../scripts/self-hosted-release');
  assert.throws(() => validateParentTraversal('/definitely-missing-sms-v3-release'), /missing parent/);
});
