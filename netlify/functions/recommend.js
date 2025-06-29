// netlify/functions/recommend.js
const { OpenAI } = require("openai");

// Helper to compute USD cost from token usage
function calculateCost(usage, model) {
  if (!usage) return null;
  const prices = {
    "gpt-3.5-turbo": { prompt: 0.0015 / 1000, completion: 0.0020 / 1000 },
    "gpt-4":         { prompt: 0.03   / 1000, completion: 0.06   / 1000 },
  };
  const p = prices[model] || prices["gpt-3.5-turbo"];
  return (
    (usage.prompt_tokens    || 0) * p.prompt +
    (usage.completion_tokens|| 0) * p.completion
  );
}

exports.handler = async (event, context) => {
  try {
    // 1) Load API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!apiKey) throw new Error("Missing OpenAI key in env");

    // 2) Parse payload
    const {
      model = "gpt-3.5-turbo",
      industry,
      company_size,
      priority_features,
      pain_points,
      current_tools,
      custom_needs,
    } = JSON.parse(event.body || "{}");

    // 3) Build a prompt that requests website_url
    const systemPrompt = `
You are OpsAdvisor, an ERP/MES/QMS recommendation engine. 
Given the user’s inputs, return up to 3 solutions as a JSON array.
Each object must have exactly these keys:
  - name: the product name
  - rationale: one or two sentences why it fits
  - website_url: string (the official vendor site, including https://; if you don’t know it exactly, look it up on the internet and include the full URL. Find the closest match available.)
Example:
[
  {
    "name":"SAP S/4HANA",
    "rationale":"Scales to large manufacturing enterprises with built-in MES modules.",
    "website_url":"https://www.sap.com/products/s4hana.html"
  },
  {
   "name":"Oracle NetSuite",
   "rationale":"Cloud-native, mid-market ERP.",
   "website_url":"https://www.netsuite.com/portal/home.shtml"
  }
]
`.trim();

    // 4) Call OpenAI
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: JSON.stringify({
            industry,
            company_size,
            priority_features,
            pain_points,
            current_tools,
            custom_needs
          })
        }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    // 5) Parse the JSON from GPT
    const raw = completion.choices[0].message.content;
    let recommendations = [];
    try {
      recommendations = JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to parse GPT JSON:", err);
      // Fallback: return empty list + raw for debugging
	  // if JSON parse fails, return raw so we can debug
      return {
        statusCode: 200,
        body: JSON.stringify({
          recommendations: [],
          raw,
          usage:      completion.usage,
          total_cost: calculateCost(completion.usage, model)
        })
      };
    }

    // 6) Compute usage & cost
    const usage     = completion.usage || {};
    const totalCost = calculateCost(usage, model);

    // 7) Return everything
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recommendations,
        usage:      { ...usage },
        total_cost: totalCost
      })
    };

  } catch (err) {
    console.error("recommend() error:", err);
    return {
      statusCode: err.status || 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
