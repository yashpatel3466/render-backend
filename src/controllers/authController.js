import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{4,10}$/;


/* REGISTER (USER ONLY) */
/* REGISTER (USER / TECHNICIAN ONLY) */
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }


    if (!["user", "technician"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }



if (!emailRegex.test(email)) {
  return res.status(400).json({ message: "Invalid email format" });
}

if (!passwordRegex.test(password)) {
  return res.status(400).json({
    message:
      "Password must be 4-10 chars, include uppercase, lowercase, number and special character"
  });
}




    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });

    res.status(201).json({
      message: "Registration successful",
      role
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};



/* LOGIN (USER / ADMIN / TECHNICIAN) */
export const loginUser = async (req, res) => {
  

  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: "Email, password and role required" });
    }
   

   if (!emailRegex.test(email)) {
  return res.status(400).json({ message: "Invalid email format" });
}


    // 🔥 FIND USER BY EMAIL ONLY
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔥 PASSWORD CHECK
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔥 ROLE CHECK (THIS FIXES YOUR ISSUE)
    if (user.role !== role) {
      return res.status(403).json({
        message: `Please login from ${user.role} login page`
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      role: user.role,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/* GET CURRENT USER PROFILE */
export const getProfile = async (req, res) => {
  try {
    // req.user is set by authenticate middleware
    const user = req.user;
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("GET PROFILE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};