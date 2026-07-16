const MAIN_ZONES = [
  { id: 'SUR', nombre: 'SUR', combina: 'CENTRO u OESTE', puedeIrCon: ['CENTRO', 'OESTE'], solo: false },
  { id: 'CENTRO', nombre: 'CENTRO', combina: 'NORTE o SUR', puedeIrCon: ['NORTE', 'SUR'], solo: false },
  { id: 'OESTE', nombre: 'OESTE', combina: 'NORTE o SUR', puedeIrCon: ['NORTE', 'SUR'], solo: false },
  { id: 'NORTE', nombre: 'NORTE', combina: 'CENTRO u OESTE', puedeIrCon: ['CENTRO', 'OESTE'], solo: false },
  { id: 'OJEDA', nombre: 'OJEDA', combina: 'Puede salir sola o con MENEGRANDE y BACHAQUERO', puedeIrCon: ['MENEGRANDE', 'BACHAQUERO'], solo: false },
  { id: 'MENEGRANDE', nombre: 'MENEGRANDE', combina: 'Siempre con OJEDA si OJEDA esta activa. No apta para camioneta', puedeIrCon: ['OJEDA'], solo: false },
  { id: 'CABIMAS', nombre: 'CABIMAS', combina: 'Sale sola', puedeIrCon: [], solo: true },
  { id: 'BACHAQUERO', nombre: 'BACHAQUERO', combina: 'Siempre con OJEDA si OJEDA esta activa', puedeIrCon: ['OJEDA'], solo: false },
];

const SOLO_ZONES = [
  { id: 'MACHIQUES', nombre: 'MACHIQUES', detalle: 'Zona independiente / solo camión', puedeIrCon: [], solo: true },
  { id: 'PUERTOS', nombre: 'PUERTOS', detalle: 'Zona independiente', puedeIrCon: [], solo: true },
  { id: 'CONCEPCION', nombre: 'CONCEPCIÓN', detalle: 'Zona independiente', puedeIrCon: [], solo: true },
  { id: 'MARA', nombre: 'MARA', detalle: 'Zona independiente / solo camión', puedeIrCon: [], solo: true },
];

const PRIORITY_WEIGHTS = { NORTE: 4, OESTE: 3, SUR: 2, CENTRO: 1 };
const DEDICATED_ZONES = ['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA'];
const VAN_RESTRICTED_ZONES = ['MENEGRANDE', 'MACHIQUES', 'MARA'];
const OJEDA_ALLOWED_PARTNERS = ['CABIMAS', 'MENEGRANDE', 'BACHAQUERO'];
const FIXED_INCOMPATIBLE_PAIRS = [['CENTRO', 'OESTE']];

function buildDispatchZoneConfigPayload() {
  const allZones = [...MAIN_ZONES, ...SOLO_ZONES];
  const incompatibles = [...FIXED_INCOMPATIBLE_PAIRS];
  const zoneNames = allZones.map((zone) => zone.nombre);

  allZones.forEach((zone) => {
    const currentName = String(zone.nombre).trim().toUpperCase();
    const allowedPartners = new Set((zone.puedeIrCon || []).map((name) => String(name).trim().toUpperCase()));

    if (zone.solo) {
      zoneNames.forEach((otherName) => {
        const normalizedOther = String(otherName).trim().toUpperCase();
        if (normalizedOther !== currentName) {
          incompatibles.push([currentName, normalizedOther]);
        }
      });
      return;
    }

    if (!allowedPartners.size) {
      return;
    }

    zoneNames.forEach((otherName) => {
      const normalizedOther = String(otherName).trim().toUpperCase();
      if (normalizedOther === currentName) {
        return;
      }

      if (!allowedPartners.has(normalizedOther)) {
        incompatibles.push([currentName, normalizedOther]);
      }
    });
  });

  return {
    prioritarias: Object.entries(PRIORITY_WEIGHTS).map(([nombre, peso]) => ({ nombre, peso })),
    dedicadas: allZones.filter((zone) => zone.solo).map((zone) => zone.nombre),
    sinCamioneta: [...VAN_RESTRICTED_ZONES],
    incompatibles,
  };
}

function getDispatchTerritoryConfig() {
  return {
    mainZones: MAIN_ZONES.map((zone) => ({ ...zone })),
    soloZones: SOLO_ZONES.map((zone) => ({ ...zone })),
    configZonas: buildDispatchZoneConfigPayload(),
  };
}

module.exports = {
  MAIN_ZONES,
  SOLO_ZONES,
  PRIORITY_WEIGHTS,
  DEDICATED_ZONES,
  VAN_RESTRICTED_ZONES,
  OJEDA_ALLOWED_PARTNERS,
  FIXED_INCOMPATIBLE_PAIRS,
  buildDispatchZoneConfigPayload,
  getDispatchTerritoryConfig,
};
