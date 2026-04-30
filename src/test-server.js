import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Simple test endpoint
app.get("/api/test", (req, res) => {
  res.json({ 
    message: "API is working", 
    timestamp: new Date().toISOString(),
    status: "success"
  });
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});
