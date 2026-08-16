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
const USERNAME_COLLATION = { locale: "en", strength: 3 };
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ADMIN_ROLE = "admin";
const USER_ROLE = "user";
const ALLOW_PUBLIC_SIGNUP = String(process.env.ALLOW_PUBLIC_SIGNUP || "false") === "true";

const normalizeUsername = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const normalizeRole = (value) => (String(value || "").trim().toLowerCase() === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE);

const FIXED_ADMIN_EMAILS = new Set([
  "egjrch@gmail.com",
  "padallain2000@gmail.com",
]);

const readAdminSeedEmails = () => new Set([
  ...FIXED_ADMIN_EMAILS,
  ...String(process.env.ADMIN_BOOTSTRAP_EMAILS || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean),
]);

const requiresApproval = (user) => user?.approvalRequired === true;
const isApprovedUser = (user) => user?.isApproved !== false;
const isAdminUser = (user) => normalizeRole(user?.role) === ADMIN_ROLE;

const buildSessionUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  role: normalizeRole(user.role),
  approvalRequired: requiresApproval(user),
  isApproved: isApprovedUser(user),
  isAdmin: isAdminUser(user),
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

const resolvePasswordResetRequestErrorMessage = (error) => {
  const message = String(error?.message || "");

  if (message.startsWith("EMAIL_CONFIG_INVALID:")) {
    return "El correo del servidor no esta configurado correctamente. Revisa EMAIL_FROM y las variables SMTP.";
  }

  if (message.startsWith("EMAIL_AUTH_FAILED:")) {
    return "El proveedor de correo rechazo las credenciales. Revisa EMAIL_USER y EMAIL_PASS.";
  }

  if (message.startsWith("EMAIL_TIMEOUT:")) {
    return "El proveedor de correo no respondio a tiempo. Revisa EMAIL_SERVICE, EMAIL_HOST o la red del servidor.";
  }

  return "No se pudo enviar el codigo de recuperacion.";
};

const resolveRegisterErrorMessage = (error) => {
  if (error?.code === 11000) {
    if (error?.keyPattern?.username) {
      return "Ese username ya existe. Se diferencia entre mayusculas y minusculas.";
    }

    if (error?.keyPattern?.email) {
      return "Ese correo ya existe.";
    }
  }

  return "Error registering user";
};

const canUseDevelopmentRecoveryFallback = (error) => {
  if (IS_PRODUCTION) {
    return false;
  }

  const message = String(error?.message || "");
  return message.startsWith("EMAIL_CONFIG_INVALID:") || String(process.env.EMAIL_LOG_ONLY || "false") === "true";
};

const buildAuthToken = (user) => jwt.sign({
  sub: String(user.id),
  username: user.username,
  email: user.email,
  role: normalizeRole(user.role),
  approvalRequired: requiresApproval(user),
  isApproved: user.isApproved !== false,
  isAdmin: normalizeRole(user.role) === ADMIN_ROLE,
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
      role: normalizeRole(payload.role),
      approvalRequired: Boolean(payload.approvalRequired),
      isApproved: payload.isApproved !== false,
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch (_error) {
    return null;
  }
};

const resolveRequesterAdminState = async (req) => {
  const requester = resolveAuthenticatedUser(req);

  if (!requester?.id) {
    return {
      isAdmin: false,
      requesterUser: null,
      requesterSession: null,
    };
  }

  const requesterUser = await User.findById(requester.id);

  if (requesterUser) {
    await ensureAdminRoleApproval(requesterUser);
  }

  if (!requesterUser || !isApprovedUser(requesterUser) || !isAdminUser(requesterUser)) {
    return {
      isAdmin: false,
      requesterUser: null,
      requesterSession: requester,
    };
  }

  return {
    isAdmin: true,
    requesterUser,
    requesterSession: buildSessionUser(requesterUser),
  };
};

const buildApprovedByPayload = (sessionUser) => ({
  id: String(sessionUser?.id || ""),
  username: String(sessionUser?.username || ""),
  email: String(sessionUser?.email || ""),
});

const ensurePasswordQuality = (password) => {
  if (typeof password !== "string" || password.length < 6) {
    return "La contrasena debe tener al menos 6 caracteres.";
  }

  return "";
};

const ensureSeedAdminPrivileges = async (user) => {
  const adminSeedEmails = readAdminSeedEmails();

  if (!adminSeedEmails.has(normalizeEmail(user?.email))) {
    return user;
  }

  let hasChanges = false;

  if (!isAdminUser(user)) {
    user.role = ADMIN_ROLE;
    hasChanges = true;
  }

  if (!isApprovedUser(user)) {
    user.isApproved = true;
    user.approvedAt = new Date();
    user.approvedBy = {
      id: "system-bootstrap",
      username: "system",
      email: "system@local",
    };
    hasChanges = true;
  }

  if (hasChanges) {
    await user.save();
  }

  return user;
};

const ensureAdminRoleApproval = async (user) => {
  if (!user || !isAdminUser(user) || isApprovedUser(user)) {
    return user;
  }

  user.isApproved = true;
  user.approvedAt = new Date();
  user.approvedBy = {
    id: "system-admin-role",
    username: "system",
    email: "system@local",
  };

  await user.save();
  return user;
};

// REGISTRO DE USUARIO (AUTENTICACIÓN)
const register = async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const email = normalizeEmail(req.body?.email);
    const requestedRole = normalizeRole(req.body?.role);

    const passwordError = ensurePasswordQuality(password);

    if (!username || !password || !email) {
      return res.status(400).json({ message: 'Username, password and email are required' });
    }

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const requesterState = await resolveRequesterAdminState(req);

    if (!ALLOW_PUBLIC_SIGNUP && !requesterState.isAdmin) {
      return res.status(403).json({
        message: "Solo un administrador puede crear usuarios nuevos.",
      });
    }

    const existingUser = await User.findOne({ username }).collation(USERNAME_COLLATION);
    if (existingUser) {
      return res.status(400).json({ message: 'Ese username ya existe. Se diferencia entre mayusculas y minusculas.' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: 'Ese correo ya existe.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const adminSeedEmails = readAdminSeedEmails();
    const seededAsAdmin = adminSeedEmails.has(email);
    const finalRole = requesterState.isAdmin && requestedRole === ADMIN_ROLE
      ? ADMIN_ROLE
      : seededAsAdmin
        ? ADMIN_ROLE
        : USER_ROLE;
    const shouldAutoApprove = requesterState.isAdmin || seededAsAdmin;
    const approvedBy = shouldAutoApprove
      ? buildApprovedByPayload(requesterState.requesterSession || {
        id: "system-bootstrap",
        username: "system",
        email: "system@local",
      })
      : {
        id: "",
        username: "",
        email: "",
      };

    const newUser = new User({
      username,
      password: hashedPassword,
      email,
      role: finalRole,
      approvalRequired: !shouldAutoApprove,
      isApproved: shouldAutoApprove,
      approvedAt: shouldAutoApprove ? new Date() : null,
      approvedBy,
    });

    await newUser.save();

    if (!newUser.isApproved) {
      return res.status(201).json({
        message: "Solicitud de usuario enviada. Debe ser aprobada por un administrador.",
        pendingApproval: true,
      });
    }

    res.status(201).json({
      message: "Usuario creado correctamente.",
      pendingApproval: false,
    });
  } catch (err) {
    console.log("Error en el registro del usuario:", err);
    res.status(500).json({ message: resolveRegisterErrorMessage(err) });
  }
};

// LOGIN DE USUARIO (AUTENTICACIÓN)
const login = async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if ((!username && !email) || !password) {
      return res.status(400).json({ message: "Username or email and password are required" });
    }

    // Buscar por username o email
    const user = username
      ? await User.findOne({ username }).collation(USERNAME_COLLATION)
      : await User.findOne({ email });

    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Apply bootstrap admin/approval first so seeded admin users are not blocked.
    await ensureSeedAdminPrivileges(user);
    await ensureAdminRoleApproval(user);

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

const getSession = async (req, res) => {
  const authenticatedUser = resolveAuthenticatedUser(req);

  if (!authenticatedUser) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const user = authenticatedUser.id
      ? await User.findById(authenticatedUser.id)
      : await User.findOne({ email: normalizeEmail(authenticatedUser.email) });

    if (user) {
      await ensureAdminRoleApproval(user);
    }

    if (!user) {
      return res.status(401).json({ authenticated: false });
    }

    const sessionUser = buildSessionUser(user);
    req.session.user = sessionUser;

    return res.status(200).json({
      authenticated: true,
      user: sessionUser,
    });
  } catch (error) {
    console.log("Error resolving session:", error);
    return res.status(500).json({ authenticated: false, message: "Error resolving session" });
  }
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

    try {
      await sendEmail({
        to: user.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      console.log("Error requesting password reset code:", error);

      if (canUseDevelopmentRecoveryFallback(error)) {
        return res.status(200).json({
          message: "El correo no esta configurado en este entorno. Usa el codigo mostrado para continuar la prueba.",
          devRecoveryCode: code,
        });
      }

      throw error;
    }

    return res.status(200).json({
      message: "Si el correo existe en el sistema, enviaremos un codigo de recuperacion.",
    });
  } catch (error) {
    console.log("Error requesting password reset code:", error);
    return res.status(500).json({ message: resolvePasswordResetRequestErrorMessage(error) });
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

    const passwordError = ensurePasswordQuality(newPassword);

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
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

const listUsersForAdmin = async (req, res) => {
  try {
    const requestedStatus = String(req.query?.status || "all").trim().toLowerCase();
    const query = {};

    if (requestedStatus === "pending") {
      query.isApproved = false;
    } else if (requestedStatus === "approved") {
      query.isApproved = true;
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .select("username email role isApproved approvedAt approvedBy createdAt updatedAt")
      .lean();

    res.status(200).json({ users });
  } catch (err) {
    console.log("Error listando usuarios para admin:", err);
    res.status(500).json({ message: "No se pudieron listar los usuarios." });
  }
};

const approveUserByAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestedApproval = req.body?.isApproved;
    const requestedRole = normalizeRole(req.body?.role);

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    if (typeof requestedApproval !== "boolean") {
      return res.status(400).json({ message: "isApproved must be boolean" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isApproved = requestedApproval;
    user.approvalRequired = !requestedApproval;
    user.role = requestedRole;
    user.approvedAt = requestedApproval ? new Date() : null;
    user.approvedBy = requestedApproval
      ? buildApprovedByPayload(req.user)
      : { id: "", username: "", email: "" };

    await user.save();

    res.status(200).json({
      message: requestedApproval
        ? "Usuario aprobado correctamente."
        : "Usuario marcado como no aprobado.",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        approvedAt: user.approvedAt,
        approvedBy: user.approvedBy,
      },
    });
  } catch (err) {
    console.log("Error aprobando usuario:", err);
    res.status(500).json({ message: "No se pudo actualizar la aprobacion del usuario." });
  }
};

const updateUserPasswordByAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const newPassword = String(req.body?.newPassword || "");

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const passwordError = ensurePasswordQuality(newPassword);

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetCode = null;
    user.passwordResetCodeExpiresAt = null;
    await user.save();

    res.status(200).json({ message: "Contrasena actualizada por administrador." });
  } catch (err) {
    console.log("Error cambiando contrasena por admin:", err);
    res.status(500).json({ message: "No se pudo actualizar la contrasena del usuario." });
  }
};

// MIDDLEWARE DE AUTORIZACIÓN
const authMiddleware = async (req, res, next) => {
  const authenticatedUser = resolveAuthenticatedUser(req);

  if (!authenticatedUser) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const user = authenticatedUser.id
      ? await User.findById(authenticatedUser.id)
      : await User.findOne({ email: normalizeEmail(authenticatedUser.email) });

    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    await ensureAdminRoleApproval(user);

    req.user = buildSessionUser(user);
    next();
  } catch (error) {
    console.log("Error validating auth user:", error);
    return res.status(500).json({ message: "Error validating user session" });
  }
};

const requireAdminRole = async (req, res, next) => {
  const authenticatedUser = resolveAuthenticatedUser(req);

  if (!authenticatedUser) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const user = authenticatedUser.id
      ? await User.findById(authenticatedUser.id)
      : await User.findOne({ email: normalizeEmail(authenticatedUser.email) });

    if (user) {
      await ensureAdminRoleApproval(user);
    }

    if (!user || !isAdminUser(user)) {
      return res.status(403).json({ message: "Solo administradores pueden ejecutar esta accion." });
    }

    req.user = buildSessionUser(user);
    next();
  } catch (error) {
    console.log("Error validating admin role:", error);
    return res.status(500).json({ message: "Error validating admin role" });
  }
};

module.exports = {
  register,
  login,
  getSession,
  logout,
  requestPasswordResetCode,
  verifyPasswordResetCode,
  resetPasswordWithCode,
  listUsersForAdmin,
  approveUserByAdmin,
  updateUserPasswordByAdmin,
  authMiddleware,
  requireAdminRole,
};