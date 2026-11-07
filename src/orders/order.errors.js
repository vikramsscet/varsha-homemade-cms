// Errors raised by the order APIs. They carry the HTTP status and a stable code
// and are rendered in the { success: false, error } envelope by the controller.
class OrderApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'OrderApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = { OrderApiError };
