
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();

// Middleware
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

// ======================================
// STUDIO CRUD API
// ======================================

// Studio collection
const studiosCol = async () =>
  (await connectDB()).collection("studios");

// Convert values to numbers
const toNum = (v) =>
  v === undefined || v === "" ? undefined : Number(v);

// Only allow approved fields to be saved
function pickStudioFields(body) {
  const data = {
    title: body.title?.trim(),
    category: body.category,
    hourlyRate: toNum(body.hourlyRate),
    securityDeposit: toNum(body.securityDeposit),
    maxCapacity: toNum(body.maxCapacity),
    location: body.location?.trim(),
    image: body.image?.trim(),
    amenities: Array.isArray(body.amenities) ? body.amenities : [],
    gallery: Array.isArray(body.gallery) ? body.gallery.filter(Boolean) : undefined,
    overview: body.overview?.trim(),
  };

  Object.keys(data).forEach((key) => {
    if (data[key] === undefined) {
      delete data[key];
    }
  });

  return data;
}

const isValidId = (id) => ObjectId.isValid(id);

// 1. GET all studios
// Supports category, search, sort and limit
app.get("/api/studios", async (req, res) => {
  try {
    const { category, search, sort, limit } = req.query;

    const query = {};

    // Category filter
    if (category && category !== "All") {
      query.category = category;
    }

    // Search by title or location
    if (search) {
      const rx = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

      query.$or = [
        { title: rx },
        { location: rx },
      ];
    }

    // Sorting options
    const sortMap = {
      newest: { createdAt: -1 },
      rating: { rating: -1, createdAt: -1 },
      "price-asc": { hourlyRate: 1 },
      "price-desc": { hourlyRate: -1 },
    };

    const col = await studiosCol();

    let cursor = col
      .find(query)
      .sort(sortMap[sort] || sortMap.newest);

    // Limit results
    const n = parseInt(limit, 10);

    if (n > 0) {
      cursor = cursor.limit(n);
    }

    const studios = await cursor.toArray();

    res.json(studios);
  } catch (error) {
    console.error("Get studios error:", error);

    res.status(500).json({
      message: "Failed to load studios.",
    });
  }
});

// 2. GET one studio by ID
app.get("/api/studios/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio id.",
      });
    }

    const studio = await (await studiosCol()).findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!studio) {
      return res.status(404).json({
        message: "Studio not found.",
      });
    }

    res.json(studio);
  } catch (error) {
    console.error("Get studio error:", error);

    res.status(500).json({
      message: "Failed to load the studio.",
    });
  }
});

// 3. GET my studio listings
app.get("/api/my-studios", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const list = await (await studiosCol())
      .find({ ownerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(list);
  } catch (error) {
    console.error("Get my studios error:", error);

    res.status(500).json({
      message: "Failed to load your listings.",
    });
  }
});

// 4. POST - Create a new studio
app.post("/api/studios", async (req, res) => {
  try {
    const data = pickStudioFields(req.body);

    const required = [
      "title",
      "category",
      "hourlyRate",
      "location",
      "image",
      "overview",
    ];

    const missing = required.filter(
      (key) => data[key] === undefined || data[key] === ""
    );

    if (missing.length) {
      return res.status(400).json({
        message: `Missing fields: ${missing.join(", ")}`,
      });
    }

    if (!req.body.ownerEmail) {
      return res.status(400).json({
        message: "Owner email is required.",
      });
    }

    const doc = {
      ...data,
      securityDeposit: data.securityDeposit ?? 0,
      maxCapacity: data.maxCapacity ?? 1,
      ownerEmail: req.body.ownerEmail,
      ownerName: req.body.ownerName || "Host",
      rating: 0,
      reviews: [],
      createdAt: new Date(),
    };

    const result = await (await studiosCol()).insertOne(doc);

    res.status(201).json({
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create studio error:", error);

    res.status(500).json({
      message: "Failed to create the studio.",
    });
  }
});

// 5. PUT - Update a studio
app.put("/api/studios/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio id.",
      });
    }

    const data = pickStudioFields(req.body);

    const result = await (await studiosCol()).updateOne(
      {
        _id: new ObjectId(req.params.id),
      },
      {
        $set: {
          ...data,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: "Studio not found.",
      });
    }

    res.json({
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Update studio error:", error);

    res.status(500).json({
      message: "Failed to update the studio.",
    });
  }
});

// 6. DELETE - Delete a studio
app.delete("/api/studios/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio id.",
      });
    }

    const result = await (await studiosCol()).deleteOne({
      _id: new ObjectId(req.params.id),
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        message: "Studio not found.",
      });
    }

    res.json({
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Delete studio error:", error);

    res.status(500).json({
      message: "Failed to delete the studio.",
    });
  }
});

// ======================================
// SERVER
// ======================================

const port = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
