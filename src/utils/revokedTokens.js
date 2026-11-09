// Login tokens that were signed out before they expired.
//
// A JWT stays valid until it expires, even after logout. This list remembers the ID (jti)
// of every signed-out token until its expiry time, so a copied token stops working at once.
//
// Kept in server memory: free and needs no database change. Limits:
//   - A server restart forgets the list, so tokens signed out before the restart work again
//     until they expire (at most JWT_EXPIRES_IN, 8h by default).
//   - With several server instances each has its own list. For that, move this to the database.
const revoked = new Map(); // jti -> expiry time in ms

// Drops entries whose token has expired anyway, so the list never grows without limit.
function prune(now) {
  for (const [jti, expiresAt] of revoked) {
    if (expiresAt <= now) revoked.delete(jti);
  }
}

// expSeconds is the token's `exp` claim (seconds since 1970).
export function revokeToken(jti, expSeconds) {
  const now = Date.now();
  prune(now);
  const expiresAt = expSeconds * 1000;
  if (jti && expiresAt > now) revoked.set(jti, expiresAt);
}

export function isTokenRevoked(jti) {
  return revoked.has(jti);
}
