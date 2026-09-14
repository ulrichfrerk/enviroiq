import OpenAI from "openai";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

// Missing key is reported at call time (401 from OpenAI), not at import time,
// so environments without the integration (staging on AWS) can still boot.
if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  console.warn("AI_INTEGRATIONS_OPENAI_API_KEY is not set; OpenAI features will fail until it is configured");
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "not-configured",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
