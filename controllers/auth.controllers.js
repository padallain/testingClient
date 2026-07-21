const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "makeroute.sid";
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const SESSION_COOKIE_SAME_SITE = process.env.SESSION_COOKIE_SAME_SITE || (SESSION_COOKIE_SECURE ? "none" : "lax");
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET || process.env.SECRET_KEY || "change_this_auth_token_secret";

const buildSessionUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
});

const buildAuthToken = (user) => jwt.sign({
  sub: String(user.id),
  username: user.username,
  email: user.email,
}, AUTH_TOKEN_SECRET, {
  expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000),
});

const extractBearerToken = (req) => {
  const authHeader = req.headers?.authorization;

  if (typeof authHeader !== "string") {
    return "";
  }

  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token ? token.trim() : "";
};

const resolveAuthenticatedUser = (req) => {
  if (req.session?.user) {
    return req.session.user;
  }

  const token = extractBearerToken(req);

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, AUTH_TOKEN_SECRET);
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
    };
  } catch (_error) {
    return null;
  }
};

// REGISTRO DE USUARIO (AUTENTICACIÓN)
const register = async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ message: 'Username, password and email are required' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      password: hashedPassword,
      email,
    });

    await newUser.save();

    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    console.log("Error en el registro del usuario:", err);
    res.status(500).json({ message: 'Error registering user' });
  }
};

// LOGIN DE USUARIO (AUTENTICACIÓN)
const login = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if ((!username && !email) || !password) {
      return res.status(400).json({ message: "Username or email and password are required" });
    }

    // Buscar por username o email
    const user = await User.findOne(
      username
        ? { username }
        : { email }
    );

    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.log("Error regenerating session:", sessionError);
        return res.status(500).json({ message: "Error logging in" });
      }

      req.session.user = buildSessionUser(user);
      req.session.cookie.maxAge = SESSION_MAX_AGE_MS;

      req.session.save((saveError) => {
        if (saveError) {
          console.log("Error saving session:", saveError);
          return res.status(500).json({ message: "Error logging in" });
        }

        const sessionUser = req.session.user;
        const authToken = buildAuthToken(sessionUser);

        return res.status(200).json({
          message: "Login successful",
          user: sessionUser,
          token: authToken,
        });
      });
    });
  } catch (err) {
    console.log("Error en login:", err);
    res.status(500).json({ message: "Error logging in" });
  }
};

const getSession = (req, res) => {
  const authenticatedUser = resolveAuthenticatedUser(req);

  if (!authenticatedUser) {
    return res.status(401).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    user: authenticatedUser,
  });
};

const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log("Error destroying session:", err);
      return res.status(500).json({ message: "Error logging out" });
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite: SESSION_COOKIE_SAME_SITE,
      secure: SESSION_COOKIE_SECURE,
    });
    return res.status(200).json({ message: "Logout successful" });
  });
};

// MIDDLEWARE DE AUTORIZACIÓN
const authMiddleware = (req, res, next) => {
  const authenticatedUser = resolveAuthenticatedUser(req);

  if (!authenticatedUser) {
    return res.status(401).json({ message: "Authentication required" });
  }

  req.user = authenticatedUser;
  next();
};

module.exports = {
  register,
  login,
  getSession,
  logout,
  authMiddleware,
};