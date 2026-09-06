const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  phone: { type: String, default: "", trim: true },
  whatsappNumber: { type: String, default: "", trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["user", "admin", "chofer", "almacenista"],
    default: "user",
    trim: true,
    index: true,
  },
  approvalRequired: { type: Boolean, default: false, index: true },
  isApproved: { type: Boolean, default: false, index: true },
  approvedAt: { type: Date, default: null },
  approvedBy: {
    id: { type: String, default: "" },
    username: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  passwordResetCode: { type: String, default: null },
  passwordResetCodeExpiresAt: { type: Date, default: null },
}, {
  timestamps: true,
});

userSchema.index(
  { username: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 3 },
  },
);

module.exports = mongoose.model("User", userSchema);
