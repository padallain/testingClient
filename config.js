require('dotenv').config();

const DB_URI = process.env.DB_URI;
const PORT = process.env.PORT || 8000;
const SECRET_KEY = process.env.SECRET_KEY;

const mongoose = require('mongoose');

const connectToDatabase = async () => {
    try {
        await mongoose.connect(DB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
    }
};

module.exports = { DB_URI, PORT, SECRET_KEY, connectToDatabase };
