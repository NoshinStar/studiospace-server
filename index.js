require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://studiospace-client-theta.vercel.app",
    ],
    credentials: true,
  })
);

app.use(express.json());

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    console.log("MongoDB connected successfully!");
  }

  return db;
}

// Home route
app.get("/", (req, res) => {
  res.send("StudioSpace server is running");
});

// MongoDB health check
app.get("/health", async (req, res) => {
  try {
    const database = await connectDB();
    await database.command({ ping: 1 });

    res.json({
      ok: true,
      message: "MongoDB connected successfully!",
    });
  } catch (error) {
    console.error("MongoDB connection error:", error);

    res.status(500).json({
      ok: false,
      message: "Database connection failed",
    });
  }
});

const port = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;