
import "dotenv/config";
import express from "express";
import cors from "cors";
import dns from "node:dns";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";
import courseRoutes from "./routes/course.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";

// DNS configuration
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const app = express();
const PORT = process.env.PORT || 5000;

// Validate required environment variable
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from environment variables.");
}

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
  })
);

// Middleware
app.use(express.json({ limit: "20kb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "API is running."
  });
});

app.use("/api/auth", authRoutes);

// Keep existing routes and endpoints
app.use("/api", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/attendance", attendanceRoutes);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);

  res.status(500).json({
    message: "Unexpected server error."
  });
});

// Export Express app for Vercel serverless deployment
export default app;

// Start the traditional Express server locally.
// Vercel will use the exported app through api/index.js instead.
if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`API running at http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Could not start API:", error.message);
      process.exit(1);
    });
}
