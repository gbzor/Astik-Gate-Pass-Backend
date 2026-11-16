// Helpers for building safe search queries. Values still go in as $1, $2... parameters;
// these only make sure a user's search text is treated as plain text.
// (Postgres error codes are in src/config/constants.js as PG_ERROR.)

// In a LIKE pattern, % and _ are wildcards. Escape them (and the escape character \)
// so searching for "50%" finds "50%" instead of matching everything.
export function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// Builds a service's "API sort name -> database column" map and checks it at startup: every
// sort field allowed in constants.js must have a column, or the server refuses to start
// (instead of a 500 error the first time someone sorts by it).
export function sortColumns(allowedFields, columns) {
  const missing = allowedFields.filter((field) => !Object.hasOwn(columns, field));
  if (missing.length) throw new Error(`No database column for sort field(s): ${missing.join(', ')}`);
  return Object.freeze({ ...columns });
}
