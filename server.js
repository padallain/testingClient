const express = require("express");
const session = require("express-session");
const morgan = require("morgan");
const cors = require("cors");
const { connectToDatabase } = require("./db"); // Importa la función de conexión
const startRoutes = require("./routes/start.routes");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === "true"
  : isProduction;
const sessionCookieSameSite = process.env.SESSION_COOKIE_SAME_SITE
  || (sessionCookieSecure ? "none" : "lax");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const hasOnlyLocalOrigins = allowedOrigins.every((origin) => /localhost|127\.0\.0\.1/.test(origin));

if (sessionCookieSecure) {
  app.set("trust proxy", 1);
}

if (isProduction && hasOnlyLocalOrigins) {
  console.warn("[config] CORS_ORIGINS no incluye un dominio publico. Las sesiones desde Netlify u otro frontend remoto seran bloqueadas.");
}

console.log("[config] auth/session", {
  nodeEnv: process.env.NODE_ENV || "development",
  allowedOrigins,
  sessionCookieSecure,
  sessionCookieSameSite,
});

// Aplica el middleware cors a todas las rutas
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(morgan("dev"));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || "change_this_session_secret",
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      secure: sessionCookieSecure,
      httpOnly: true,
      sameSite: sessionCookieSameSite,
      maxAge: SESSION_MAX_AGE_MS,
    },
}));

app.use(express.json());
app.use("/", startRoutes);

const PORT = process.env.PORT || 3000;

connectToDatabase()
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });