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
    let rawJsonText = null;

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

            if (!interaction.output_text) throw new Error("Gemini returned an empty response.");
            
            rawJsonText = interaction.output_text;
            break; // Success! Break out of the loop.

        } catch (error: any) {
            const errorMessage = error?.message?.toLowerCase() || "";
            const status = error?.status;
            
            if (status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
                console.warn(`[Gemini] Key hit rate limit. Retrying with key ${i + 2} of ${availableKeys.length}...`);
                continue; 
            }
            
            if (i === availableKeys.length - 1) throw error;
        }
    }

    if (!rawJsonText) {
        throw new Error("All Gemini API keys failed or were exhausted.");
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