require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

const connectToDatabase = async () => {
    try {
        const databaseUri = process.env.MONGODB_URI || process.env.DB_URI;

        if (!databaseUri) {
            throw new Error('MONGODB_URI or DB_URI is not configured');
        }

        // Conectar a MongoDB con la misma URI para local y producción
        await mongoose.connect(databaseUri, {
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