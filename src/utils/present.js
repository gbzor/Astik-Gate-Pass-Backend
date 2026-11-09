// Shapes database rows into what the API sends back. Keeping this in one place
// makes sure secrets like passwordHash never leak into a response.

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    schoolId: user.schoolId,
    createdAt: user.createdAt,
  };
}
