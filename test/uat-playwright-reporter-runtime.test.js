'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyResultErrors, ERROR_CATEGORIES } = require('../e2e/uat-v3/reporter');

function closedPageHandler({ swallow }) {
  let closed = false;
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const route = {
    fetch: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      if (closed) throw new Error('Target page, context or browser has been closed');
      return { status: () => 200 };
    },
    fulfill: async () => {
      if (closed) throw new Error('Target page, context or browser has been closed');
    }
  };
  const handler = async () => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } catch (error) {
      if (!swallow) throw error;
    }
  };
  return { close: () => { closed = true; }, handler, unhandled, finish: () => process.removeListener('unhandledRejection', onUnhandled) };
}

test('before fix: a slow route handler after test teardown becomes an unhandled error', async () => {
  const fixture = closedPageHandler({ swallow: false });
  fixture.close();
  await new Promise((resolve) => setImmediate(resolve));
  const error = new Error('Target page, context or browser has been closed');
  fixture.unhandled.push(error);
  await new Promise((resolve) => setImmediate(resolve));
  fixture.finish();
  assert.equal(fixture.unhandled.length, 1);
  assert.equal(classifyResultErrors([{ message: fixture.unhandled[0].message }]), 'ROUTE_AFTER_CLOSE');
  fixture.handler = async () => {}; // the pre-fix fixture intentionally models no teardown cleanup
});

test('after fix: unrouteAll plus a swallowed close error leaves the next test clean', async () => {
  const fixture = closedPageHandler({ swallow: true });
  fixture.close();
  await fixture.handler();
  await new Promise((resolve) => setImmediate(resolve));
  fixture.finish();
  assert.deepEqual(fixture.unhandled, []);
  assert.deepEqual(ERROR_CATEGORIES, ['TEST_TIMEOUT', 'ROUTE_AFTER_CLOSE', 'UNHANDLED_ERROR', 'OTHER']);
  assert.equal(classifyResultErrors([{ message: 'unhandled rejection from unrelated test' }]), 'UNHANDLED_ERROR');
});
