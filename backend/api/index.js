
import app from "../src/server.js";
import { connectDB } from "../src/config/db.js";

let dbConnection;

export default async function handler(req, res) {
  try {
    if (!dbConnection) {
      dbConnection = connectDB().catch((error) => {
        dbConnection = null;
        throw error;
      });
    }

    await dbConnection;
    return app(req, res);
  } catch (error) {
    console.error("Vercel API error:", error);
    return res.status(500).json({
      message: "Backend database connection or server error."
    });
  }
}
