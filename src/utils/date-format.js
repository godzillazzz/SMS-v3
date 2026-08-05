const DISPLAY_TIME_ZONE = 'Asia/Bangkok';
function parseDate(value) { const parsed = value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null; }
function formatThaiDate(value) { const parsed = parseDate(value); return parsed ? new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'long', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(parsed) : '-'; }
function formatThaiMonthYear(value) { const parsed = parseDate(value); return parsed ? new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(parsed) : '-'; }
function formatThaiDateTime(value) { const parsed = parseDate(value); if (!parsed) return '-'; const time = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TIME_ZONE }).format(parsed); return `${formatThaiDate(parsed)} เวลา ${time} น.`; }
module.exports = { formatThaiDate, formatThaiDateTime, formatThaiMonthYear };
