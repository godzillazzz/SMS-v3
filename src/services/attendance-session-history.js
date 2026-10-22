'use strict';

function sessionOf(value) {
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

module.exports = { sessionOf };
