import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();

// 1️⃣ Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));
app.use(express.json());

// 2️⃣ MongoDB connection
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
  });

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

// 3️⃣ User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  profile: {
    name: String,
    age: Number,
    weight: Number,
    height: Number,
    gender: String,
    fitnessGoal: String,
    diet: String,
    calories: Number,
    mealsPerDay: Number,
  },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// 4️⃣ Meal Plan Schema
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

// 5️⃣ JWT Middleware to protect routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "your-secret-key-change-this", (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user; // Add user info to request
    next();
  });
};

// 6️⃣ Root route
app.get("/", (req, res) => {
  res.json({ 
    status: "Server is running ✅",
    timestamp: new Date().toISOString(),
    routes: [
      "POST /api/auth/register",
      "POST /api/auth/login",
      "GET /api/auth/me",
      "PUT /api/auth/profile",
      "POST /api/meal-plan",
      "GET /api/meal-plan",
      "DELETE /api/meal-plan/:planId"
    ],
    mongodb: mongoose.connection.readyState === 1 ? "Connected ✅" : "Disconnected ❌"
  });
});

// 7️⃣ Health check
app.get("/api/test", (req, res) => {
  res.json({ 
    status: "Backend is running ✅",
    mongodb: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// ========================================
// AUTHENTICATION ROUTES
// ========================================

// Register new user
app.post("/api/auth/register", async (req, res) => {
  console.log("📥 POST /api/auth/register");
  
  try {
    const { email, password, profile } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      profile: profile || {}
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your-secret-key-change-this",
      { expiresIn: "7d" }
    );

    console.log(`✅ User registered: ${email}`);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        email: user.email,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error("❌ Registration error:", error);
    res.status(500).json({ error: "Registration failed", message: error.message });
  }
});

// Login user
app.post("/api/auth/login", async (req, res) => {
  console.log("📥 POST /api/auth/login");
  
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your-secret-key-change-this",
      { expiresIn: "7d" }
    );

    console.log(`✅ User logged in: ${email}`);

    res.json({
      message: "Login successful",
      token,
      user: {
        email: user.email,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed", message: error.message });
  }
});

// Get current user (protected route)
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  console.log("📥 GET /api/auth/me");
  
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      email: user.email,
      profile: user.profile
    });
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Update user profile (protected route)
app.put("/api/auth/profile", authenticateToken, async (req, res) => {
  console.log("📥 PUT /api/auth/profile");
  
  try {
    const { profile } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { profile },
      { new: true }
    ).select("-password");

    console.log(`✅ Profile updated for: ${user.email}`);

    res.json({
      message: "Profile updated successfully",
      user: {
        email: user.email,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error("❌ Profile update error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ========================================
// MEAL PLAN ROUTES (Now Protected)
// ========================================

// Generate meal plan (protected)
app.post("/api/meal-plan", authenticateToken, async (req, res) => {
  console.log("📥 POST /api/meal-plan");
  
  const { prompt } = req.body;
  const userId = req.user.email;

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database connection unavailable" });
  }

  if (!process.env.OPENAI_API_KEY) {
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
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let jsonData;
    try {
      jsonData = JSON.parse(content);
    } catch {
      const match = content.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (match) {
        jsonData = JSON.parse(match[0]);
      } else {
        throw new Error("Could not extract valid JSON from AI response");
      }
    }

    if (!jsonData || !jsonData.meals || !Array.isArray(jsonData.meals)) {
      return res.status(500).json({ error: "AI did not return valid meal plan format." });
    }

    const savedPlan = new MealPlan({ userId, meals: jsonData.meals });
    await savedPlan.save();
    
    console.log(`✅ Generated ${jsonData.meals.length} meals`);

    res.json(savedPlan);
  } catch (error) {
    console.error("❌ Error generating meal plan:", error.message);
    res.status(500).json({ error: "Failed to generate meal plan", message: error.message });
  }
});

// Fetch past meal plans (protected)
app.get("/api/meal-plan", authenticateToken, async (req, res) => {
  console.log("📥 GET /api/meal-plan");
  
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database connection unavailable" });
    }

    const plans = await MealPlan.find({ userId: req.user.email })
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log(`✅ Found ${plans.length} meal plan(s)`);
    res.json(plans);
  } catch (err) {
    console.error("❌ Error fetching meal plans:", err);
    res.status(500).json({ error: "Failed to fetch meal plans" });
  }
});

// Delete a meal plan (protected)
app.delete("/api/meal-plan/:planId", authenticateToken, async (req, res) => {
  console.log(`📥 DELETE /api/meal-plan/${req.params.planId}`);
  
  try {
    const result = await MealPlan.findOneAndDelete({
      _id: req.params.planId,
      userId: req.user.email // Make sure user owns this plan
    });
    
    if (!result) {
      return res.status(404).json({ error: "Meal plan not found" });
    }
    
    console.log(`🗑️ Deleted meal plan: ${req.params.planId}`);
    res.json({ success: true, message: "Meal plan deleted" });
  } catch (err) {
    console.error("❌ Error deleting meal plan:", err);
    res.status(500).json({ error: "Failed to delete meal plan" });
  }
});

// ========================================
// ERROR HANDLERS
// ========================================

app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});