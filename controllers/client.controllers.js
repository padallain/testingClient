const Client = require("../models/client.model");
const bcrypt = require("bcryptjs");

// REGISTRO DE USUARIO (CLIENTE)
const registerClient = async (req, res) => {
  try {
    const { id, nombre, password, latitude, longitude, start, end } = req.body;

    if (!id || !nombre || !password || !latitude || !longitude || !start || !end) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRegex.test(start) || !timeRegex.test(end)) {
      return res.status(400).json({ message: 'Invalid time format. Use HH:mm:ss' });
    }

    const existingClient = await Client.findOne({ id });
    if (existingClient) {
      return res.status(400).json({ message: 'Client with this ID already exists' });
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const newClient = new Client({
      id,
      nombre,
      password: hashedPassword,
      location: { latitude, longitude },
      schedule: { start, end },
    });

    await newClient.save();

    res.status(201).json({ message: 'Client registered successfully' });
  } catch (err) {
    console.log("Error en el registro del cliente:", err);
    res.status(500).json({ message: 'Error registering client' });
  }
};

const getClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar el cliente en la base de datos por su ID
    const client = await Client.findOne({ id });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Construir el enlace de Google Maps
    const googleMapsLink = `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`;

    // Responder con la información del cliente y el enlace de Google Maps
    res.status(200).json({
      id: client.id,
      nombre: client.nombre,
      location: client.location,
      schedule: client.schedule,
      googleMapsLink,
    });
  } catch (err) {
    console.log("Error al obtener el cliente:", err);
    res.status(500).json({ message: 'Error fetching client' });
  }
};

module.exports = {
  registerClient,
  getClient,
};