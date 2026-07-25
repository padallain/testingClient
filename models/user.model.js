const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  passwordResetCode: { type: String, default: null },
  passwordResetCodeExpiresAt: { type: Date, default: null },
});

userSchema.index(
  { username: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 3 },
  },
);

module.exports = mongoose.model("User", userSchema);
