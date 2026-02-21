import { GoogleGenAI, Type } from "@google/genai";

// Lazy initialization to prevent crash if process.env is missing or key is empty
let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is missing. AI features will be disabled.");
      return null;
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export interface FileDoc {
  summary: string;
  keyComponents: string[];
  responsibilities: string;
  complexity: "Low" | "Medium" | "High";
}

export async function generateFileDoc(fileName: string, content: string): Promise<FileDoc> {
  const ai = getAI();
  if (!ai) {
    throw new Error("Gemini API key is not configured.");
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `Analyze the following C++ file and provide a structured documentation.
    File Name: ${fileName}
    Content:
    ${content.substring(0, 10000)} // Truncate if too long
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: "A brief summary of what the file does." },
          keyComponents: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "List of main classes, structs, or key functions." 
          },
          responsibilities: { type: Type.STRING, description: "What this file is responsible for in the codebase." },
          complexity: { 
            type: Type.STRING, 
            enum: ["Low", "Medium", "High"],
            description: "Estimated complexity of the code."
          }
        },
        required: ["summary", "keyComponents", "responsibilities", "complexity"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return {
      summary: "Failed to generate summary.",
      keyComponents: [],
      responsibilities: "Unknown",
      complexity: "Medium"
    };
  }
}
