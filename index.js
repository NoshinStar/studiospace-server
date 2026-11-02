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
// BOOKING API
// ======================================

// Booking collection
const bookingsCol = async () =>
  (await connectDB()).collection("bookings");

// Convert HH:MM time into minutes
const toMinutes = (hhmm) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Convert minutes back into HH:MM
const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// NEW: Find a confirmed booking that overlaps the requested time slot
async function findConflict({ studioId, date, startMinutes, endMinutes, excludeId }) {
  const query = {
    studioId,
    date,
    status: "Confirmed",
    startMinutes: { $lt: endMinutes },
    endMinutes: { $gt: startMinutes },
  };

  if (excludeId) {
    query._id = { $ne: new ObjectId(excludeId) };
  }

  return (await bookingsCol()).findOne(query);
}

// POST - Create a booking
app.post("/api/bookings", async (req, res) => {
  try {
    const { studioId, date, startTime, hours, userEmail, userName } = req.body;

    if (!isValidId(studioId)) {
      return res.status(400).json({ message: "Invalid studio." });
    }

    if (!userEmail) {
      return res.status(400).json({ message: "Please log in to book." });
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      return res.status(400).json({ message: "Choose a valid date." });
    }

    const startMin = toMinutes(startTime);
    const h = Number(hours);

    if (startMin === null || !Number.isInteger(h) || h < 1 || h > 12) {
      return res.status(400).json({
        message: "Choose a valid start time and duration.",
      });
    }

    const endMin = startMin + h * 60;

    if (endMin > 24 * 60) {
      return res.status(400).json({
        message: "A booking must end by midnight.",
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (new Date(`${date}T00:00:00.000Z`) < today) {
      return res.status(400).json({
        message: "The date can't be in the past.",
      });
    }

    const studio = await (await studiosCol()).findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).json({ message: "Studio not found." });
    }

    if (studio.ownerEmail === userEmail) {
      return res.status(400).json({
        message: "You can't book your own studio.",
      });
    }

    // NEW: reject if the slot overlaps a confirmed booking
    const conflict = await findConflict({
      studioId: studio._id.toString(),
      date,
      startMinutes: startMin,
      endMinutes: endMin,
    });

    if (conflict) {
      return res.status(409).json({
        message: `This studio is already booked from ${conflict.startTime} to ${conflict.endTime} on ${date}. Please choose another time.`,
      });
    }

    const doc = {
      studioId: studio._id.toString(),
      studioTitle: studio.title,
      studioImage: studio.image,
      studioLocation: studio.location,
      ownerEmail: studio.ownerEmail,
      hourlyRate: studio.hourlyRate,
      securityDeposit: studio.securityDeposit ?? 0,
      date,
      startTime: toHHMM(startMin),
      endTime: toHHMM(endMin),
      startMinutes: startMin,
      endMinutes: endMin,
      hours: h,
      totalPrice: studio.hourlyRate * h,
      userEmail,
      userName: userName || "Creator",
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await (await bookingsCol()).insertOne(doc);

    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Create booking error:", error);

    res.status(500).json({
      message: "Failed to create the booking.",
    });
  }
});


// GET - Load bookings for a user
app.get("/api/my-bookings", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const list = await (await bookingsCol())
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(list);
  } catch (error) {
    console.error("Get my bookings error:", error);

    res.status(500).json({
      message: "Failed to load your bookings.",
    });
  }
});


// PATCH - Cancel a pending booking
app.patch("/api/bookings/:id/cancel", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid booking id.",
      });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const result = await (await bookingsCol()).updateOne(
      {
        _id: new ObjectId(req.params.id),
        userEmail: email,
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          cancelledAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(400).json({
        message: "Only your pending bookings can be cancelled.",
      });
    }

    res.json({
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Cancel booking error:", error);

    res.status(500).json({
      message: "Failed to cancel the booking.",
    });
  }
});


// ======================================
// HOST BOOKING REQUESTS (NEW)
// ======================================

// GET - Booking requests for studios owned by this host
app.get("/api/host-bookings", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const list = await (await bookingsCol())
      .find({ ownerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(list);
  } catch (error) {
    console.error("Get host bookings error:", error);

    res.status(500).json({
      message: "Failed to load booking requests.",
    });
  }
});

// PATCH - Host confirms, rejects or completes a booking
app.patch("/api/bookings/:id/status", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid booking id.",
      });
    }

    const { email, status } = req.body;

    if (!email || !["Confirmed", "Cancelled", "Completed"].includes(status)) {
      return res.status(400).json({
        message: "Invalid request.",
      });
    }

    const col = await bookingsCol();

    const booking = await col.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found.",
      });
    }

    if (booking.ownerEmail !== email) {
      return res.status(403).json({
        message: "Only the studio host can update this booking.",
      });
    }

    const allowed = {
      Pending: ["Confirmed", "Cancelled"],
      Confirmed: ["Completed", "Cancelled"],
    };

    if (!allowed[booking.status]?.includes(status)) {
      return res.status(400).json({
        message: `A ${booking.status} booking can't be marked ${status}.`,
      });
    }

    // Double-booking guard when confirming
    if (status === "Confirmed") {
      const conflict = await findConflict({
        studioId: booking.studioId,
        date: booking.date,
        startMinutes: booking.startMinutes,
        endMinutes: booking.endMinutes,
        excludeId: req.params.id,
      });

      if (conflict) {
        return res.status(409).json({
          message: `Can't confirm: another booking is already confirmed from ${conflict.startTime} to ${conflict.endTime} on ${booking.date}.`,
        });
      }
    }

    await col.updateOne(
      { _id: booking._id },
      { $set: { status, updatedAt: new Date() } }
    );

    res.json({ status });
  } catch (error) {
    console.error("Update booking status error:", error);

    res.status(500).json({
      message: "Failed to update the booking.",
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