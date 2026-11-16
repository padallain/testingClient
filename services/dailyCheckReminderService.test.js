const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDailyCheckReportContent, formatLocalDateKey, getDateReferenceForLocalDate, getTodayDayRange, getZonedDateParts } = require("./dailyCheckReminderService");

test("El reporte usa las 10:00 y el dia calendario de Caracas aunque el servidor este en UTC", () => {
  const reportTime = new Date("2026-10-26T14:00:00.000Z");
  const range = getTodayDayRange(reportTime);

  assert.equal(getZonedDateParts(reportTime).hour, 10);
  assert.equal(formatLocalDateKey(reportTime), "2026-10-26");
  assert.equal(range.start.toISOString(), "2026-10-26T04:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-27T03:59:59.999Z");
});

test("El rango diario admite una zona horaria explicita", () => {
  const reportTime = new Date("2026-10-26T14:00:00.000Z");
  const range = getTodayDayRange(reportTime, "UTC");

  assert.equal(formatLocalDateKey(reportTime, "UTC"), "2026-10-26");
  assert.equal(range.start.toISOString(), "2026-10-26T00:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-26T23:59:59.999Z");
});

test("La fecha historica del CLI se interpreta como dia local de Caracas", () => {
  const referenceDate = getDateReferenceForLocalDate("2026-11-13");

  assert.equal(formatLocalDateKey(referenceDate), "2026-11-13");
  assert.throws(() => getDateReferenceForLocalDate("2026-02-30"), /no existe/);
  assert.throws(() => getDateReferenceForLocalDate("viernes 13"), /YYYY-MM-DD/);
});

test("El reporte incluye vehiculo, personal y choferes pendientes escapados para HTML", () => {
  const content = buildDailyCheckReportContent([
    { displayName: "Ana <chofer>", status: "reporte ok", reports: [{ placa: "ABC123", modelo: "Camion", anio: 2020, personalTrabajo: "Jose & Luis", destino: "Centro" }] },
    { displayName: "Chofer pendiente", status: "pendiente", reports: [] },
  ]);

  assert.match(content.text, /Vehiculo: ABC123 - Camion 2020/);
  assert.match(content.text, /Personal\/ayudante: Jose & Luis/);
  assert.match(content.text, /Sin chequeo registrado para este dia/);
  assert.match(content.html, /Ana &lt;chofer&gt;/);
  assert.match(content.html, /Jose &amp; Luis/);
});