import { GoogleGenAI } from "@google/genai";
import { config } from "./config";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Raw JSON Schema (No Zod required)
const receiptJsonSchema = {
    type: "object",
    properties: {
        merchant_name: {
            type: "string",
            description: "The name of the store or merchant."
        },
        transaction_date: {
            type: "string",
            description: "The date of the transaction in YYYY-MM-DD format."
        },
        total_amount: {
            type: "number",
            description: "The final total amount paid."
        },
        tax_amount: {
            type: "number",
            description: "The tax amount paid. If none is found, return 0."
        },
        currency: {
            type: "string",
            description: "The 3-letter currency code, e.g., USD, EUR, GBP."
        },
        category: {
            type: "string",
            description: "Categorize the expense. Must be one of: Meals, Travel, Software, Office Supplies, Advertising, Miscellaneous."
        }
    },
    required: ["merchant_name", "transaction_date", "total_amount", "tax_amount", "currency", "category"]
};

export async function processReceiptImage(base64Image: string, mimeType: string) {
    const prompt = `
    Analyze this receipt image. Extract the merchant name, date, total amount, tax amount, and currency. 
    Categorize the expense appropriately based on the merchant. 
    Ensure the date is formatted as YYYY-MM-DD.
    `;

    const interaction = await ai.interactions.create({
        model: "gemini-3.6-flash", 
        input: [
            { type: "text", text: prompt },
            {
                type: "image",
                data: base64Image,
                mime_type: mimeType
            }
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
}