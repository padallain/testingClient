const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const SECRET_KEY = process.env.SECRET_KEY || "default_secret";

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

    // Generar token de verificación
    const token = jwt.sign({ username: newUser.username, email: newUser.email }, SECRET_KEY, { expiresIn: "1d" });

    // Enviar correo de verificación
    //await sendVerificationEmail(newUser.email, token);

    res.status(201).json({ message: 'User registered successfully. Please check your email to verify your account.' });
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

    // Generar token JWT
    const token = jwt.sign({ username: user.username, email: user.email }, SECRET_KEY, { expiresIn: "8h" });

    res.status(200).json({ token });
  } catch (err) {
    console.log("Error en login:", err);
    res.status(500).json({ message: "Error logging in" });
  }
};

// MIDDLEWARE DE AUTORIZACIÓN
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = {
  register,
  login,
  authMiddleware,
};