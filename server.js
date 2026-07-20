const express = require("express");
const session = require("express-session");
const morgan = require("morgan");
const cors = require("cors");
const { connectToDatabase } = require("./db"); // Importa la función de conexión
const startRoutes = require("./routes/start.routes");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === "true"
  : isProduction;
const sessionCookieSameSite = process.env.SESSION_COOKIE_SAME_SITE
  || (sessionCookieSecure ? "none" : "lax");

const app = express();
const allowedOrigins = [...new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean),
])];
const normalizedAllowedOrigins = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/, "")));
const hasOnlyLocalOrigins = allowedOrigins.every((origin) => /localhost|127\.0\.0\.1/.test(origin));

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = String(origin).replace(/\/$/, "");

  if (normalizedAllowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  try {
    const url = new URL(normalizedOrigin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch (error) {
    return false;
  }
}

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
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.warn(`[cors] blocked origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  optionsSuccessStatus: 204,
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