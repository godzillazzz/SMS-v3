'use strict';

/**
 * Split PostgreSQL statements without treating semicolons inside quoted
 * literals, quoted identifiers, comments, or dollar-quoted bodies as breaks.
 */
function splitSqlStatements(sql) {
  if (typeof sql !== 'string') throw new TypeError('sql must be a string');

  const statements = [];
  let start = 0;
  let i = 0;
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
      } else {
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (sql[i + 1] === quote) {
          i += 2;
        } else {
          quote = null;
          i += 1;
        }
      } else if (char === '\\' && quote === "'") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      i += 1;
      continue;
    }
    if (char === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        i += dollarTag.length;
        continue;
      }
    }
    if (char === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
    i += 1;
  }

  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function executeSqlStatements(prisma, sql) {
  for (const statement of splitSqlStatements(sql)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

module.exports = { splitSqlStatements, executeSqlStatements };
