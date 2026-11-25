function normalizeDriverIdentity(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function canAccessDriverRoute(user, assignedDriverId) {
  const role = normalizeDriverIdentity(user?.role);
  if (role === "admin") return true;
  if (role !== "chofer") return false;

  const assignedIdentity = normalizeDriverIdentity(assignedDriverId);
  if (!assignedIdentity) return false;

  return [user?.driverId, user?.username, user?.email]
    .map(normalizeDriverIdentity)
    .some((identity) => identity && identity === assignedIdentity);
}

module.exports = { normalizeDriverIdentity, canAccessDriverRoute };