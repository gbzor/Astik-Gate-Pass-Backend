// Throw one of these from any route to send a clean error response.
// The message is shown to the user, so never put internal details in it.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
