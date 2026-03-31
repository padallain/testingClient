require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

const connectToDatabase = async () => {
    try {
        if (!process.env.DB_URI) {
            throw new Error('DB_URI is not configured');
        }

        // Conectar a MongoDB con la misma URI para local y producción
        await mongoose.connect(process.env.DB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000, // Tiempo de espera de 5 segundos
        });
        console.log('Conectado a MongoDB');
    } catch (err) {
        console.error('Error conectando a MongoDB:', err);
        throw err;
    }
};

module.exports = { connectToDatabase };