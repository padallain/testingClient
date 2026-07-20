const User = require("../models/user.model");
const bcrypt = require("bcryptjs");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const buildSessionUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
});

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

        return res.status(200).json({
          message: "Login successful",
          user: req.session.user,
        });
      });
    });
  } catch (err) {
    console.log("Error en login:", err);
    res.status(500).json({ message: "Error logging in" });
  }
};

const getSession = (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    user: req.session.user,
  });
};

const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log("Error destroying session:", err);
      return res.status(500).json({ message: "Error logging out" });
    }

    res.clearCookie("connect.sid");
    return res.status(200).json({ message: "Logout successful" });
  });
};

// MIDDLEWARE DE AUTORIZACIÓN
const authMiddleware = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  req.user = req.session.user;
  next();
};

module.exports = {
  register,
  login,
  getSession,
  logout,
  authMiddleware,
};