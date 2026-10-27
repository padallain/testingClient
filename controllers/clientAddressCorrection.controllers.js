const mongoose = require('mongoose');
const Client = require('../models/client.model');
const Report = require('../models/clientLocationReport.model');
const { correctionError, normalizeCorrectionProposal, canReviewCorrection } = require('../services/clientAddressCorrection.service');

const text = value => String(value ?? '').trim();
const actor = user => ({ id: text(user?.id), name: text(user?.username || user?.email) });
const handler = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    console.error('[address-correction]', error.message);
    if (error.code === 11000) return res.status(409).json({ message: 'Ya existe una sede con ese nombre para este cliente.' });
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'No se pudo procesar la solicitud de direccion.' });
  }
};
const reportView = report => ({ ...report, status: canReviewCorrection(report) ? report.status || 'pending' : 'legacy',
  canReview: canReviewCorrection(report) && (report.status || 'pending') === 'pending' });

exports.createRequest = handler(async (req, res) => {
  const clientId = text(req.body.clientId);
  if (!clientId) throw correctionError('Busca un cliente registrado para solicitar el arreglo.');
  const proposal = normalizeCorrectionProposal(req.body);
  const matches = await Client.find({ id: clientId }).lean();
  if (!matches.length) throw correctionError('Cliente no encontrado.', 404);
  const hasBranch = Object.prototype.hasOwnProperty.call(req.body, 'sucursal');
  const sucursal = text(req.body.sucursal);
  if (matches.length > 1 && !hasBranch) throw correctionError('Selecciona la sede del cliente.');
  const selected = hasBranch ? matches.find(client => text(client.sucursal) === sucursal) : matches[0];
  if (!selected) throw correctionError('La sede seleccionada no existe.', 404);
  if (!Number.isFinite(selected.location?.latitude) || !Number.isFinite(selected.location?.longitude)) throw correctionError('El cliente no tiene un punto actual valido para comparar.');
  const branchChanged = proposal.proposedSucursal !== undefined && proposal.proposedSucursal !== text(selected.sucursal);
  if (branchChanged && matches.some(client => String(client._id) !== String(selected._id)
    && text(client.sucursal).toLowerCase() === proposal.proposedSucursal.toLowerCase())) {
    throw correctionError('Ya existe una sede con ese nombre para este cliente.', 409);
  }
  if (!branchChanged && selected.location.latitude === proposal.proposedLocation.latitude && selected.location.longitude === proposal.proposedLocation.longitude) throw correctionError('La ubicacion y la sede propuestas son iguales a las registradas.');
  const reporter = actor(req.user);
  const duplicate = await Report.findOne({ targetClientId: selected._id, reporterId: reporter.id, status: 'pending',
    ...(proposal.proposedSucursal !== undefined ? { proposedSucursal: proposal.proposedSucursal } : {}),
    'proposedLocation.latitude': proposal.proposedLocation.latitude, 'proposedLocation.longitude': proposal.proposedLocation.longitude }).lean();
  if (duplicate) throw correctionError('Ya tienes una solicitud pendiente para ese punto y sede.', 409);
  const report = await Report.create({ clientId: selected.id, targetClientId: selected._id, sucursal: text(selected.sucursal),
    reporterId: reporter.id, reporterName: reporter.name, clientFound: true, status: 'pending', ...proposal,
    clientSnapshot: { id: selected.id, nombre: selected.nombre, sucursal: text(selected.sucursal), location: selected.location, schedule: selected.schedule } });
  res.status(201).json({ report: reportView(report.toObject()), reportId: report._id,
    message: 'Solicitud enviada. La ubicacion y la sede no cambian hasta que el administrador la apruebe.' });
});

exports.listRequests = handler(async (req, res) => {
  const status = req.query.status || 'pending';
  if (!['pending', 'approved', 'rejected', 'legacy', 'all'].includes(status)) throw correctionError('Estado de solicitud invalido.');
  const query = {};
  if (status === 'legacy') query.targetClientId = null;
  else if (status !== 'all') { query.status = status; query.targetClientId = { $ne: null }; }
  if (req.user?.role !== 'admin') query.reporterId = actor(req.user).id;
  const reports = await Report.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const targets = reports.filter(report => report.targetClientId).map(report => report.targetClientId);
  const currentClients = targets.length ? await Client.find({ _id: { $in: targets } }).lean() : [];
  const currentById = new Map(currentClients.map(client => [String(client._id), client]));
  res.json({ reports: reports.map(report => {
    const current = currentById.get(String(report.targetClientId));
    const original = report.clientSnapshot?.location;
    return { ...reportView(report), currentLocation: current?.location || null,
      locationChanged: Boolean(report.status === 'pending' && canReviewCorrection(report) && (!current || current.location?.latitude !== original?.latitude
        || current.location?.longitude !== original?.longitude)) };
  }), limit: 500 });
});

exports.approveRequest = handler(async (req, res) => {
  const id = req.params.reportId;
  if (!mongoose.isValidObjectId(id)) throw correctionError('Folio de solicitud invalido.');
  const note = text(req.body.reviewNote);
  if (note.length > 2000) throw correctionError('Observacion de revision demasiado larga.');
  const session = await mongoose.startSession();
  let approved;
  let updatedClient;
  try {
    await session.withTransaction(async () => {
      const report = await Report.findById(id).session(session).lean();
      if (!report) throw correctionError('Solicitud no encontrada.', 404);
      if (!canReviewCorrection(report)) throw correctionError('Este reporte antiguo no tiene una ubicacion propuesta. Se conserva como historial.', 409);
      if (report.status !== 'pending') throw correctionError('La solicitud ya fue revisada.', 409);
      const proposal = normalizeCorrectionProposal({ details: report.details, proposedLocation: report.proposedLocation,
        accuracyMeters: report.accuracyMeters, proposedSucursal: report.proposedSucursal });
      if (proposal.proposedSucursal !== undefined && proposal.proposedSucursal !== text(report.sucursal)) {
        const branches = await Client.find({ id: report.clientId }).session(session).lean();
        if (branches.some(client => String(client._id) !== String(report.targetClientId)
          && text(client.sucursal).toLowerCase() === proposal.proposedSucursal.toLowerCase())) {
          throw correctionError('Ya existe una sede con ese nombre para este cliente.', 409);
        }
      }
      updatedClient = await Client.findOneAndUpdate({ _id: report.targetClientId, id: report.clientId,
        sucursal: report.sucursal || { $in: ['', null] },
        'location.latitude': report.clientSnapshot.location.latitude, 'location.longitude': report.clientSnapshot.location.longitude },
      { $set: { location: proposal.proposedLocation,
        ...(proposal.proposedSucursal !== undefined ? { sucursal: proposal.proposedSucursal } : {}) } }, { session, new: true, runValidators: true }).lean();
      if (!updatedClient) throw correctionError('El cliente o su punto cambio desde la solicitud. Rechazala y solicita una ubicacion actualizada.', 409);
      approved = await Report.findOneAndUpdate({ _id: id, status: 'pending' }, { $set: {
        status: 'approved', reviewedBy: actor(req.user), reviewedAt: new Date(), reviewNote: note,
      } }, { session, new: true, runValidators: true }).lean();
      if (!approved) throw correctionError('La solicitud fue revisada por otra persona.', 409);
    });
  } catch (error) {
    if (/Transaction numbers|replica set|mongos/i.test(error.message || '')) {
      throw correctionError('La aprobacion requiere MongoDB con transacciones (Atlas o replica set). No se modifico el cliente.', 503);
    }
    throw error;
  } finally { await session.endSession(); }
  res.json({ report: reportView(approved), client: updatedClient, message: 'Cambio aprobado. Ubicacion y sede del cliente actualizadas.' });
});

exports.rejectRequest = handler(async (req, res) => {
  const id = req.params.reportId;
  if (!mongoose.isValidObjectId(id)) throw correctionError('Folio de solicitud invalido.');
  const note = text(req.body.reviewNote);
  if (!note || note.length > 2000) throw correctionError('Indica el motivo del rechazo (maximo 2000 caracteres).');
  const rejected = await Report.findOneAndUpdate({ _id: id, status: 'pending', targetClientId: { $ne: null } },
    { $set: { status: 'rejected', reviewedBy: actor(req.user), reviewedAt: new Date(), reviewNote: note } }, { new: true, runValidators: true }).lean();
  if (!rejected) throw correctionError('La solicitud no existe, es antigua o ya fue revisada.', 409);
  res.json({ report: reportView(rejected), message: 'Solicitud rechazada. La ubicacion del cliente no cambio.' });
});

exports.requireDriverOrAdmin = (req, res, next) => {
  if (!['chofer', 'admin'].includes(req.user?.role)) return res.status(403).json({ message: 'Solo choferes y administradores pueden solicitar correcciones.' });
  next();
};