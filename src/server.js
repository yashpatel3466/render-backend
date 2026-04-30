import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";

dotenv.config();

// Connect to database (don't block startup if it fails)
connectDB().catch(console.error);

const app = express();

// CORS configuration
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({ 
    message: "API is working", 
    timestamp: new Date().toISOString(),
    status: "success"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("Backend is running");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: "Something went wrong!",
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    message: "Endpoint not found",
    path: req.path
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/api/test`);
});
