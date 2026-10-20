class HttpError extends Error {
  constructor(statusCode, message, details, { publicCode = null, publicMessage = null } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.publicCode = publicCode || details?.code || null;
    this.publicMessage = publicMessage || null;
  }
}

module.exports = HttpError;
