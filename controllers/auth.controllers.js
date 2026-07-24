const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../services/sendEmail");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "makeroute.sid";
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const SESSION_COOKIE_SAME_SITE = process.env.SESSION_COOKIE_SAME_SITE || (SESSION_COOKIE_SECURE ? "none" : "lax");
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET || process.env.SECRET_KEY || "change_this_auth_token_secret";

const buildSessionUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
});

const generatePasswordResetCode = () => String(Math.floor(100000 + (Math.random() * 900000)));

const buildPasswordResetMessage = ({ username, code }) => ({
  subject: "Codigo de recuperacion de contrasena",
  text: [
    `Hola ${username || "usuario"},`,
    "",
    `Tu codigo de recuperacion es: ${code}`,
    "",
    "Este codigo vence en 15 minutos.",
    "Si no solicitaste este cambio, ignora este correo.",
  ].join("\n"),
  html: `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
      <h2 style="margin-bottom: 12px;">Recuperacion de contrasena</h2>
      <p>Hola ${username || "usuario"},</p>
      <p>Tu codigo de recuperacion es:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 18px 0;">${code}</p>
      <p>Este codigo vence en 15 minutos.</p>
      <p>Si no solicitaste este cambio, ignora este correo.</p>
    </div>
  `,
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

const requestPasswordResetCode = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ message: "Debes indicar el correo asociado a la cuenta." });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({
        message: "Si el correo existe en el sistema, enviaremos un codigo de recuperacion.",
      });
    }

    const code = generatePasswordResetCode();
    user.passwordResetCode = code;
    user.passwordResetCodeExpiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MS);
    await user.save();

    const message = buildPasswordResetMessage({
      username: user.username,
      code,
    });

    await sendEmail({
      to: user.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return res.status(200).json({
      message: "Si el correo existe en el sistema, enviaremos un codigo de recuperacion.",
    });
  } catch (error) {
    console.log("Error requesting password reset code:", error);
    return res.status(500).json({ message: "No se pudo enviar el codigo de recuperacion." });
  }
};

const verifyPasswordResetCode = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ message: "Correo y codigo son obligatorios." });
    }

    const user = await User.findOne({ email });

    if (!user || !user.passwordResetCode || !user.passwordResetCodeExpiresAt) {
      return res.status(400).json({ message: "El codigo de recuperacion es invalido o ya no esta disponible." });
    }

    const isExpired = user.passwordResetCodeExpiresAt.getTime() < Date.now();
    const isCodeMismatch = user.passwordResetCode !== code;

    if (isExpired || isCodeMismatch) {
      return res.status(400).json({ message: "El codigo de recuperacion es invalido o ha vencido." });
    }

    return res.status(200).json({ message: "Codigo validado correctamente." });
  } catch (error) {
    console.log("Error verifying password reset code:", error);
    return res.status(500).json({ message: "No se pudo validar el codigo de recuperacion." });
  }
};

const resetPasswordWithCode = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "Correo, codigo y nueva contrasena son obligatorios." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "La nueva contrasena debe tener al menos 6 caracteres." });
    }

    const user = await User.findOne({ email });

    if (!user || !user.passwordResetCode || !user.passwordResetCodeExpiresAt) {
      return res.status(400).json({ message: "El codigo de recuperacion es invalido o ya no esta disponible." });
    }

    const isExpired = user.passwordResetCodeExpiresAt.getTime() < Date.now();
    const isCodeMismatch = user.passwordResetCode !== code;

    if (isExpired || isCodeMismatch) {
      return res.status(400).json({ message: "El codigo de recuperacion es invalido o ha vencido." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetCode = null;
    user.passwordResetCodeExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: "Contrasena actualizada correctamente." });
  } catch (error) {
    console.log("Error resetting password with code:", error);
    return res.status(500).json({ message: "No se pudo actualizar la contrasena." });
  }
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
  requestPasswordResetCode,
  verifyPasswordResetCode,
  resetPasswordWithCode,
  authMiddleware,
};