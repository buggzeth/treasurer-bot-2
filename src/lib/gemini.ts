// --- START OF FILE gemini.ts ---

import { GoogleGenAI } from "@google/genai";
import { config } from "./config";

// Raw JSON Schema (No Zod required)
const receiptJsonSchema = {
    type: "object",
    properties: {
        merchant_name: { type: "string", description: "The name of the store or merchant." },
        transaction_date: { type: "string", description: "The date of the transaction in YYYY-MM-DD format." },
        total_amount: { type: "number", description: "The final total amount paid." },
        tax_amount: { type: "number", description: "The tax amount paid. If none is found, return 0." },
        currency: { type: "string", description: "The 3-letter currency code, e.g., USD, EUR, GBP." },
        category: { type: "string", description: "Categorize the expense. Must be one of: Meals, Travel, Software, Office Supplies, Advertising, Miscellaneous." }
    },
    required: ["merchant_name", "transaction_date", "total_amount", "tax_amount", "currency", "category"]
};

export async function processReceiptImage(base64Image: string, mimeType: string) {
    const prompt = `
    Analyze this receipt image. Extract the merchant name, date, total amount, tax amount, and currency. 
    Categorize the expense appropriately based on the merchant. 
    Ensure the date is formatted as YYYY-MM-DD.
    `;

    // Shuffle keys to prevent concurrent serverless functions from defaulting to the same key first
    const availableKeys = [...config.geminiApiKeys].sort(() => Math.random() - 0.5);

    for (let i = 0; i < availableKeys.length; i++) {
        const apiKey = availableKeys[i];
        const ai = new GoogleGenAI({ apiKey });

        try {
            const interaction = await ai.interactions.create({
                model: "gemini-3.6-flash", 
                input: [
                    { type: "text", text: prompt },
                    { type: "image", data: base64Image, mime_type: mimeType }
                ],
                response_format: {
                    type: 'text',
                    mime_type: 'application/json',
                    schema: receiptJsonSchema
                },
            });

            if (!interaction.output_text) {
                throw new Error("Gemini returned an empty response.");
            }

            return JSON.parse(interaction.output_text);

        } catch (error: any) {
            const errorMessage = error?.message?.toLowerCase() || "";
            const status = error?.status;
            
            // If it's a rate limit or quota issue, we retry with the next key in the array
            if (status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
                console.warn(`[Gemini] Key hit rate limit. Retrying with key ${i + 2} of ${availableKeys.length}...`);
                continue; 
            }
            
            // If it's the last key in the array, or a different error (e.g., bad image format), throw it entirely.
            if (i === availableKeys.length - 1) {
                throw error;
            }
        }
    }

    throw new Error("All Gemini API keys are currently rate limited or exhausted.");
}