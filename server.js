const express = require("express");
const session = require("express-session");
const morgan = require("morgan");
const cors = require("cors"); 
const { connectToDatabase } = require("./db"); // Importa la función de conexión
const startRoutes = require("./routes/start.routes");

const app = express();

// Aplica el middleware cors a todas las rutas
app.use(cors({
  origin: '*',
}));

app.use(morgan("dev"));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});


app.use(session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.json());
app.use("/", startRoutes);

const PORT = process.env.PORT || 3000;

connectToDatabase()
  .then(() => {
    console.log('Connected to MongoDB');

    // Ahora puedes iniciar el servidor Express
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });