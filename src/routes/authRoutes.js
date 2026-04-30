import express from "express";
import { registerUser, loginUser, getProfile } from "../controllers/authController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);   // USER / TECHNICIAN
router.post("/login", loginUser);         // USER / ADMIN / TECHNICIAN
router.get("/profile", authenticate, getProfile);  // Get current user profile

export default router;
