function correctionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeCorrectionProposal(input) {
  const details = typeof input.details === 'string' ? input.details.trim() : '';
  if (!details || details.length > 2000) throw correctionError('Describe la direccion correcta y el motivo (maximo 2000 caracteres).');
  const coordinate = (value, maximum, label) => {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === ''
      || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > maximum) throw correctionError(`${label} invalida.`);
    return Number(value);
  };
  const latitude = coordinate(input.proposedLocation?.latitude, 90, 'Latitud propuesta');
  const longitude = coordinate(input.proposedLocation?.longitude, 180, 'Longitud propuesta');
  let accuracyMeters = null;
  if (input.accuracyMeters != null && input.accuracyMeters !== '') {
    if (!['number', 'string'].includes(typeof input.accuracyMeters) || !Number.isFinite(Number(input.accuracyMeters)) || Number(input.accuracyMeters) < 0) {
      throw correctionError('Precision GPS invalida.');
    }
    accuracyMeters = Number(input.accuracyMeters);
  }
  return { details, proposedLocation: { latitude, longitude }, accuracyMeters };
}

function canReviewCorrection(report) {
  return Boolean(report?.targetClientId && Number.isFinite(report?.proposedLocation?.latitude)
    && Number.isFinite(report?.proposedLocation?.longitude));
}

module.exports = { correctionError, normalizeCorrectionProposal, canReviewCorrection };