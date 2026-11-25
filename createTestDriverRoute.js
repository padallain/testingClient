require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const mongoose = require("mongoose");
const User = require("./models/user.model");
const RouteAssignment = require("./models/routeAssignment.model");
const { connectToDatabase } = require("./db");

const TEST_EMAIL = "padchofer@gmail.com";
const TEST_DRIVER_ID = "27558739";
const TEST_ROUTE_LABEL = "DEMO-GUIA-PAD-CHOFER-NO-USAR";

const makeStop = (order, clientId, nombre, latitude, longitude) => ({
  order,
  clientId,
  sucursal: "",
  nombre,
  weight: 100,
  location: { latitude, longitude },
  googleMapsLink: `https://www.google.com/maps?q=${latitude},${longitude}`,
  dispatched: false,
  dispatchedAt: null,
});

(async () => {
  try {
    await connectToDatabase();
    const user = await User.findOne({ email: TEST_EMAIL }).collation({ locale: "en", strength: 2 });
    if (!user || String(user.role).toLowerCase() !== "chofer") {
      throw new Error(`No existe un usuario chofer con el correo ${TEST_EMAIL}.`);
    }
    if (user.driverId && user.driverId !== TEST_DRIVER_ID) {
      throw new Error(`${TEST_EMAIL} ya tiene otra cedula vinculada; no se modifico el perfil.`);
    }

    let route = await RouteAssignment.findOne({ driverId: TEST_DRIVER_ID, routeLabel: TEST_ROUTE_LABEL });
    const alreadyExisted = Boolean(route);
    if (!route) {
      const date = new Date().toISOString().slice(0, 10);
      const companyId = "DEMO-PAD-CHOFER-27558739";
      const guideNumber = "DEMO-27558739-01";
      const names = ["Cliente demostracion Norte", "Cliente demostracion Centro", "Cliente demostracion Sur"];
      const coordinates = [[10.67, -71.63], [10.65, -71.61], [10.63, -71.60]];
      const stops = names.map((name, index) => makeStop(index + 1, `DEMO-${index + 1}`, name, ...coordinates[index]));
      const orders = stops.map((stop, index) => ({
        orderNumber: `PED-DEMO-${String(index + 1).padStart(3, "0")}`,
        clientId: stop.clientId,
        sucursal: "",
        clientName: stop.nombre,
        companyId,
        companyName: "EMPRESA DE DEMOSTRACION",
        date,
        total: 0,
      }));
      const googleMapsRouteLinks = [`https://www.google.com/maps/dir/${coordinates.map(([lat, lng]) => `${lat},${lng}`).join("/")}`];

      route = await RouteAssignment.create({
        driverId: TEST_DRIVER_ID,
        driverName: user.username,
        routeLabel: TEST_ROUTE_LABEL,
        routeComment: "DATOS FICTICIOS DE PRUEBA. NO DESPACHAR NI REPORTAR NOVEDADES.",
        loadGuide: {
          number: guideNumber,
          date,
          orders,
          totalAmount: 0,
          subGuides: [{
            companyId,
            companyName: "EMPRESA DE DEMOSTRACION",
            number: guideNumber,
            numberKey: guideNumber,
            orders,
            totalAmount: 0,
          }],
        },
        routeType: "closest",
        routeTypeLabel: "Ruta de demostracion",
        uniqueClientCount: stops.length,
        totalWeight: 300,
        totalDistanceKm: 8.5,
        originalTotalDistanceKm: 8.5,
        googleMapsRouteLinks,
        originalGoogleMapsRouteLinks: googleMapsRouteLinks,
        openRouteLink: googleMapsRouteLinks[0],
        originalOpenRouteLink: googleMapsRouteLinks[0],
        status: "active",
        stops,
        originalStops: stops,
      });
    }

    user.driverId = TEST_DRIVER_ID;
    await user.save();
    console.log(JSON.stringify({
      created: !alreadyExisted,
      driverEmail: TEST_EMAIL,
      driverUsername: user.username,
      driverId: TEST_DRIVER_ID,
      routeId: String(route._id),
      routeLabel: route.routeLabel,
      fakeStops: route.stops.length,
      guideNumber: route.loadGuide?.number,
    }));
  } catch (error) {
    console.error("No se pudo crear la guia de demostracion:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();