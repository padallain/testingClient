const MAIN_ZONES = [];

const SOLO_ZONES = [];

const PRIORITY_WEIGHTS = {};
const DEDICATED_ZONES = [];
const VAN_RESTRICTED_ZONES = [];
const OJEDA_ALLOWED_PARTNERS = [];
const FIXED_INCOMPATIBLE_PAIRS = [];

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
