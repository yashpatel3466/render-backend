import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || "mongodb+srv://yash_dantaliya:Yash@3466@civicfix-cluster.48gedhx.mongodb.net/?appName=CivicFix-Cluster");
    console.log("MongoDB Connected:", conn.connection.host);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    // Don't exit in production, just log the error
    if (process.env.NODE_ENV !== "production") {
      process.exit(1);
    }
  }
};

export default connectDB;
