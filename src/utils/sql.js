// Helpers for building safe search queries. Values still go in as $1, $2... parameters;
// these only make sure a user's search text is treated as plain text.

// In a LIKE pattern, % and _ are wildcards. Escape them (and the escape character \)
// so searching for "50%" finds "50%" instead of matching everything.
export function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// Postgres error codes the services turn into friendly messages.
export const PG_UNIQUE_VIOLATION = '23505';
// Deleting a row that other tables still point at. Which code Postgres uses depends on the
// foreign key's ON DELETE rule: RESTRICT gives 23001, NO ACTION gives 23503.
export const PG_STILL_REFERENCED = ['23001', '23503'];
