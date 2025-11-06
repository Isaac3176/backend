import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 1️⃣ Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// 2️⃣ Define Schema + Model
const mealSchema = new mongoose.Schema({
  userId: String,
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

// 3️⃣ Existing OpenAI meal generation route (extended)
app.post("/api/meal-plan", async (req, res) => {
  const { prompt, userId } = req.body;
  console.log("🔑 Loaded OpenAI key starts with:", process.env.OPENAI_API_KEY?.slice(0, 12));

  try {
    // 🧠 Call OpenAI
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

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log("AI raw response:", content);

    // 🧩 Try to parse JSON
    let jsonData;
    try {
      jsonData = JSON.parse(content);
    } catch {
      const match = content.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (match) {
        jsonData = JSON.parse(match[0]);
      }
    }

    if (!jsonData) {
      return res.status(500).json({ error: "AI did not return valid JSON." });
    }

    // 💾 Save meal plan to MongoDB
    const savedPlan = new MealPlan({
      userId: userId || "guest",
      meals: jsonData.meals,
    });

    await savedPlan.save();
    console.log("✅ Meal plan saved to database for:", userId || "guest");

    res.json(savedPlan);
  } catch (error) {
    console.error("Error from OpenAI:", error);
    res.status(500).json({ error: "Failed to fetch or save meal plan" });
  }
});

// 4️⃣ Optional route: fetch past meal plans
app.get("/api/meal-plan/:userId", async (req, res) => {
  try {
    const plans = await MealPlan.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch meal plans" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
