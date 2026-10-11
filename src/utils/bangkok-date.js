'use strict';

// Represent the Asia/Bangkok calendar day as a date-only UTC value for Prisma @db.Date.
function bangkokToday(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('Valid reconciliation time is required.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

module.exports = { bangkokToday };
