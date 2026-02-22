require('dotenv').config();
const { ChatGroq } = require("@langchain/groq");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

// Initialize Groq client
// Using llama-3.1-70b-versatile as a strong proxy for Kimi K2 if not directly available, 
// or specifically connecting to it if the user has a custom endpoint (defaulting to standard Groq models for now).
const model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile", // High capability model for sensitive detection
    temperature: 0,
});

const SYSTEM_PROMPT = `You are a specialized Nigerian safety agent designed to detect dangerous behavior in chat messages (including pidgin language). 
Your task is to analyze the following message and return "UNSAFE" if it contains:
1. Grooming (building trust for sexual purposes)
2. Sexual interest in minors
3. Requests for illicit images of minors
4. Sexual language directed at a child
5. Severe Profanity, Bullying, or Harassment ("fuck you", insults, threats)

If the message contains ANY indication of the above, return "UNSAFE".
If the message is clearly safe or unrelated, return "SAFE".

Respond ONLY with "SAFE" or "UNSAFE". Do not add any explanation.`;

const SUMMARY_SYSTEM_PROMPT = `You are a helpful safety assistant for parents. 
Your task is to summarize the recent chat history of a child based on the parent's query.
You will receive a list of recent messages (Sender Name, Time, Content).
Brieftly answer the parent's question. Focus on who they are talking to and if there is anything concerning.
If the parent asks "Who messaged?", list the unique names and a tiny summary of what they said.
Keep it concise and friendly.`;

async function analyzeMessage(messageText) {
    try {
        if (!messageText || messageText.trim().length === 0) return false;

        const response = await model.invoke([
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(messageText),
        ]);

        const result = response.content.trim().toUpperCase();

        // If it detects unsafe content, return true (danger)
        return result.includes("UNSAFE");
    } catch (error) {
        console.error("Error analyzing message with Groq:", error.message);
        // Fail safe (or fail open depending on policy, here fail safe to avoid spamming alerts on error)
        return false;
    }
}

async function summarizeActivity(messages, parentQuery) {
    try {
        if (!messages || messages.length === 0) return "No recent activity found.";

        // Format messages for the LLM
        const historyText = messages.map(m =>
            `[${m.timestamp}] ${m.senderName} (${m.senderJid}): ${m.content}`
        ).join("\n");

        const prompt = `Parent's Question: "${parentQuery}"\n\nRecent Chat History:\n${historyText}`;

        const response = await model.invoke([
            new SystemMessage(SUMMARY_SYSTEM_PROMPT),
            new HumanMessage(prompt),
        ]);

        return response.content.trim();
    } catch (error) {
        console.error("Error summarizing activity:", error);
        return "I'm sorry, I couldn't generate a summary right now. Please try again.";
    }
}

module.exports = { analyzeMessage, summarizeActivity };
