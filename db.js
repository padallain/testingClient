require('dotenv').config(); // Cargar variables de entorno desde .env
const mongoose = require('mongoose');

const connectToDatabase = async () => {
    try {
        // Conectar a MongoDB con la misma URI para local y producción
        await mongoose.connect(process.env.DB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000, // Tiempo de espera de 5 segundos
        });
        console.log('Conectado a MongoDB');
        console.log('DB_URI:', process.env.DB_URI);
    } catch (err) {
        console.error('Error conectando a MongoDB:', err);
    }
};

module.exports = { connectToDatabase };