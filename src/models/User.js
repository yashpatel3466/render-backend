import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: String,
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true,
    select: false   // 🔥 THIS IS REQUIRED
  },
  role: {
    type: String,
    enum: ["user", "admin", "technician"],
    default: "user"
  }
}, { timestamps: true });

export default mongoose.model("User", userSchema);
