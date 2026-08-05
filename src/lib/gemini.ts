// --- START OF FILE gemini.ts ---

import { GoogleGenAI } from "@google/genai";
import { config } from "./config";

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
    Ensure the date is strictly formatted as YYYY-MM-DD.
    `;

    const availableKeys = [...config.geminiApiKeys].sort(() => Math.random() - 0.5);
    const models = ["gemini-3.6-flash", "gemini-3.5-flash"]; // Prioritized list of models
    let rawJsonText = null;

    outerLoop: for (let i = 0; i < availableKeys.length; i++) {
        const apiKey = availableKeys[i];
        const ai = new GoogleGenAI({ apiKey });

        for (let j = 0; j < models.length; j++) {
            const currentModel = models[j];
            
            try {
                const interaction = await ai.interactions.create({
                    model: currentModel, 
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

                if (!interaction.output_text) throw new Error("Gemini returned an empty response.");
                
                rawJsonText = interaction.output_text;
                break outerLoop; // Success! Break out of all loops.

            } catch (error: any) {
                const errorMessage = error?.message?.toLowerCase() || "";
                const status = error?.status;
                const isRateLimit = status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit');
                
                if (isRateLimit) {
                    console.warn(`[Gemini] Key ${i + 1}/${availableKeys.length} hit rate limit on ${currentModel}.`);
                    
                    if (j === models.length - 1) {
                        console.warn(`[Gemini] Exhausted models for key ${i + 1}. Retrying with key ${i + 2} of ${availableKeys.length}...`);
                    } else {
                        console.warn(`[Gemini] Retrying with fallback model ${models[j + 1]}...`);
                    }
                    continue; // Try the next model, or next key if models are exhausted
                }
                
                // If it's the very last key and last model, throw the error
                if (i === availableKeys.length - 1 && j === models.length - 1) {
                    throw error;
                }

                // If it's NOT a rate limit error (e.g. invalid image, auth error), 
                // there's no point in trying another model on the same key. Move to the next key.
                if (!isRateLimit) {
                    break;
                }
            }
        }
    }

    if (!rawJsonText) {
        throw new Error("All Gemini API keys and fallback models failed or were exhausted.");
    }

    // --- SANITIZATION LAYER ---
    const parsedData = JSON.parse(rawJsonText);

    // 1. Sanitize Date (Must be YYYY-MM-DD for PostgreSQL)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!parsedData.transaction_date || !dateRegex.test(parsedData.transaction_date)) {
        // Fallback to today's date if Gemini fails to find one
        parsedData.transaction_date = new Date().toISOString().split('T')[0];
    }

    // 2. Sanitize Numbers (Ensure they are actually numbers, fallback to 0)
    parsedData.total_amount = Number(parsedData.total_amount) || 0;
    parsedData.tax_amount = Number(parsedData.tax_amount) || 0;

    // 3. Sanitize Strings
    parsedData.merchant_name = parsedData.merchant_name || "Unknown Merchant";
    parsedData.currency = (parsedData.currency || "USD").toUpperCase().substring(0, 3);
    parsedData.category = parsedData.category || "Miscellaneous";

    return parsedData;
}