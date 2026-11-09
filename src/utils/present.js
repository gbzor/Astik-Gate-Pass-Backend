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

// A vehicle as the API sends it. `owner` is only filled in on admin views.
export function publicVehicle(vehicle) {
  if (!vehicle) return null;
  return {
    id: vehicle.id,
    ownerId: vehicle.ownerId,
    plateNumber: vehicle.plateNumber,
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
    ...(vehicle.owner && { owner: vehicle.owner }),
  };
}

// Paging details sent with every list, so the frontend can draw "Page 2 of 7".
export function pageInfo({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
