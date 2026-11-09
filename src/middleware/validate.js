// Checks req.body against a Zod schema and replaces it with the cleaned values.
// Unknown fields are dropped, so users can't sneak in fields like "role": "admin".
export function validateBody(schema) {
  return (req, res, next) => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}

// Checks the URL's ?query=string. Express 5 makes req.query read-only, so the
// cleaned values go on req.validQuery instead. Controllers read only req.validQuery.
export function validateQuery(schema) {
  return (req, res, next) => {
    req.validQuery = schema.parse(req.query ?? {});
    next();
  };
}

// Checks route parameters such as /vehicles/:id and replaces them with the cleaned values.
export function validateParams(schema) {
  return (req, res, next) => {
    req.params = schema.parse(req.params ?? {});
    next();
  };
}
