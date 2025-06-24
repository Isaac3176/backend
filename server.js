import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/meal-plan", async (req, res) => {
  const prompt = req.body.prompt;
console.log("🔑 Loaded OpenAI key starts with:", process.env.OPENAI_API_KEY?.slice(0, 12));


  try {
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
    console.log("Full OpenAI API response:", data);
    const content = data.choices?.[0]?.message?.content || "";
    console.log("AI raw response:", content); // <-- Add this line here

    // Clean/sanitize and extract the JSON part from AI's response
    let jsonData;

    try {
      jsonData = JSON.parse(content);
    } catch (err) {
      // Try to extract the first JSON object
      // This regex matches the first "{" and the matching "}"
      const match = content.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (match) {
        try {
          jsonData = JSON.parse(match[0]);
        } catch {
          jsonData = null;
        }
      }
    }

    if (!jsonData) {
      return res.status(500).json({ error: "AI did not return valid JSON." });
    }

    res.json(jsonData); // send sanitized JSON to client
  } catch (error) {
    console.error("Error from OpenAI:", error);
    res.status(500).json({ error: "Failed to fetch meal plan" });
  }

});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));