import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../src/models/User.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to DB:", mongoose.connection.name);
console.log("Mongo URI:", process.env.MONGO_URI);

const adminExists = await User.findOne({ role: "admin" });

if (adminExists) {
  console.log("Admin already exists");
  process.exit();
}

const hashedPassword = await bcrypt.hash("admin123", 10);

await User.create({
  name: "Super Admin",
  email: "admin@gmail.com",
  password: hashedPassword,
  role: "admin"
});

console.log("Admin created successfully");
process.exit();
