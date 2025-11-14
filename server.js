import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import mongoose from "mongoose";

dotenv.config();

const app = express();

// 1️⃣ Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));
app.use(express.json());

// 2️⃣ MongoDB connection with better error handling
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected to MongoDB");
    console.log("📊 Database:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    console.error("Make sure MONGO_URI is set in environment variables");
  });

// Monitor MongoDB connection
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err);
});

// 3️⃣ Mongoose Schema + Model
const mealSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  meals: [
    {
      name: String,
      ingredients: [String],
      calories: Number,
      protein: Number,
      carbs: Number,
      fats: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const MealPlan = mongoose.model("MealPlan", mealSchema);

// 4️⃣ Root route
app.get("/", (req, res) => {
  res.json({ 
    status: "Server is running ✅",
    timestamp: new Date().toISOString(),
    routes: [
      "GET /api/test",
      "POST /api/meal-plan",
      "GET /api/meal-plan/:userId"
    ],
    mongodb: mongoose.connection.readyState === 1 ? "Connected ✅" : "Disconnected ❌"
  });
});

// 5️⃣ Health check
app.get("/api/test", (req, res) => {
  console.log("📥 GET /api/test - Request received");
  res.json({ 
    status: "Backend is running ✅",
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// 6️⃣ Generate meal plan via OpenAI
app.post("/api/meal-plan", async (req, res) => {
  console.log("📥 POST /api/meal-plan - Request received");
  
  const { prompt, userId } = req.body;
  
  if (!userId) {
    console.error("❌ userId is missing");
    return res.status(400).json({ error: "userId is required" });
  }

  // Check MongoDB connection
  if (mongoose.connection.readyState !== 1) {
    console.error("❌ MongoDB not connected");
    return res.status(503).json({ error: "Database connection unavailable" });
  }

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set");
    return res.status(500).json({ error: "OpenAI API key not configured" });
  }

  try {
    console.log(`🤖 Generating meal plan for user: ${userId}`);
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ OpenAI API error:", errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    if (!content) {
      console.error("❌ Empty response from OpenAI");
      throw new Error("Empty response from OpenAI");
    }

    console.log("📄 Raw AI response:", content.substring(0, 100) + "...");

    // Safely parse JSON from AI response
    let jsonData;
    try {
      jsonData = JSON.parse(content);
    } catch {
      console.log("⚠️ Attempting to extract JSON from response");
      const match = content.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (match) {
        jsonData = JSON.parse(match[0]);
      } else {
        throw new Error("Could not extract valid JSON from AI response");
      }
    }

    if (!jsonData || !jsonData.meals || !Array.isArray(jsonData.meals)) {
      console.error("❌ Invalid JSON structure:", jsonData);
      return res.status(500).json({ error: "AI did not return valid meal plan format." });
    }

    console.log(`✅ Generated ${jsonData.meals.length} meals`);

    // Save to DB
    const savedPlan = new MealPlan({ userId, meals: jsonData.meals });
    await savedPlan.save();
    
    console.log(`💾 Saved meal plan to database with ID: ${savedPlan._id}`);

    res.json(savedPlan);
  } catch (error) {
    console.error("❌ Error generating meal plan:", error.message);
    res.status(500).json({ 
      error: "Failed to generate or save meal plan.",
      message: error.message 
    });
  }
});

// 7️⃣ Fetch past meal plans
app.get("/api/meal-plan/:userId", async (req, res) => {
  const userId = req.params.userId;
  console.log(`📥 GET /api/meal-plan/${userId} - Request received`);
  
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      console.error("❌ MongoDB not connected");
      return res.status(503).json({ error: "Database connection unavailable" });
    }

    const plans = await MealPlan.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log(`✅ Found ${plans.length} meal plan(s) for user: ${userId}`);
    res.json(plans);
  } catch (err) {
    console.error("❌ Error fetching meal plans:", err);
    res.status(500).json({ 
      error: "Failed to fetch meal plans.",
      message: err.message 
    });
  }
});

// 8️⃣ Delete a meal plan (optional feature)
app.delete("/api/meal-plan/:planId", async (req, res) => {
  console.log(`📥 DELETE /api/meal-plan/${req.params.planId}`);
  
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database connection unavailable" });
    }

    const result = await MealPlan.findByIdAndDelete(req.params.planId);
    
    if (!result) {
      return res.status(404).json({ error: "Meal plan not found" });
    }
    
    console.log(`🗑️ Deleted meal plan: ${req.params.planId}`);
    res.json({ success: true, message: "Meal plan deleted" });
  } catch (err) {
    console.error("❌ Error deleting meal plan:", err);
    res.status(500).json({ 
      error: "Failed to delete meal plan.",
      message: err.message 
    });
  }
});

// 9️⃣ 404 handler for undefined routes
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: "Route not found",
    path: req.url,
    method: req.method,
    availableRoutes: [
      "GET /",
      "GET /api/test",
      "POST /api/meal-plan",
      "GET /api/meal-plan/:userId",
      "DELETE /api/meal-plan/:planId"
    ]
  });
});

// 🔟 Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

// 1️⃣1️⃣ Start server on Render's port
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'Not set'}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, closing server gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, closing server gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});