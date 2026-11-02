'use strict';

// Galat layanan AI dengan pesan ramah petani. retryable=true berarti layak tombol "Coba lagi".
class AIServiceError extends Error {
  constructor(message, { retryable = true, cause } = {}) {
    super(message);
    this.retryable = retryable;
    this.cause = cause;
  }
}

module.exports = { AIServiceError };
