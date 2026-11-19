const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessDriverRoute } = require("./driverRouteAccess.service");

test("Solo el chofer asignado o un administrador puede acceder a la ruta", () => {
  const driver = { role: "chofer", username: "09726276", email: "driver@example.com" };

  assert.equal(canAccessDriverRoute(driver, "09726276"), true);
  assert.equal(canAccessDriverRoute(driver, "DRIVER@example.com"), true);
  assert.equal(canAccessDriverRoute(driver, "12345678"), false);
  assert.equal(canAccessDriverRoute({ ...driver, role: "user" }, "09726276"), false);
  assert.equal(canAccessDriverRoute(null, "09726276"), false);
  assert.equal(canAccessDriverRoute({ role: "admin" }, "12345678"), true);
});