// Checks req.body against a Zod schema and replaces it with the cleaned values.
// Unknown fields are dropped, so users can't sneak in fields like "role": "admin".
export function validateBody(schema) {
  return (req, res, next) => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}
