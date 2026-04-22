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

const SYSTEM_PROMPT = `You are a specialized Nigerian child safety agent fluent in Nigerian Pidgin English, Nigerian English, Yoruba/Igbo/Hausa slangs, and internet slang commonly used by Nigerians.

You MUST understand these Nigerian Pidgin expressions and slangs when detecting threats:

**Grooming / Sexual Pidgin phrases (UNSAFE):**
- "I wan show you something" / "make I show you something" (luring)
- "you fine die" / "you too fine" / "your body sweet" / "you get body" (sexualizing appearance)
- "no tell anybody" / "e go be our secret" / "no let your mama know" (secrecy/grooming)
- "send your picture" / "snap yourself" / "send your body" / "show me wetin you get" (requesting images)
- "I go buy phone for you" / "I go send you money" / "I go take care of you" (material grooming)
- "you don mature" / "you don big" / "you no be small pikin again" (normalizing sexual interest in minors)
- "come my house" / "make we see" / "I wan carry you go somewhere" (isolation attempts)
- "if you love me you go do am" / "prove say you love me" (emotional manipulation)
- "knack" / "nyash" / "preeq" / "gbola" / "toto" / "do the do" / "rompe" (sexual terms)

**Bullying / Harassment / Threats Pidgin phrases (UNSAFE):**
- "I go beat you" / "I go wound you" / "I go scatter your face" (physical threats)
- "you be mumu" / "ode" / "olodo" / "werey" / "craze person" (insults when aggressive/repeated)
- "I go expose you" / "I get your nudes" / "I go post am" (sextortion/blackmail)
- "go kill yourself" / "you no suppose dey alive" / "better you die" (death threats)
- "ashawo" / "olosho" / "runs girl" (sexual shaming)
- "I know where you dey" / "I go find you" (stalking threats)
- "thunder fire you" / "your mama go die" (severe verbal abuse)
- "fuck you" / "bastard" / "idiot" when used aggressively

**Common Nigerian internet slangs to understand:**
- "sha" (though), "abi" (right?), "shey" (isn't it), "wahala" (trouble), "gist" (tell/story)
- "cruise" (fun/joke — usually SAFE), "vibe" (hang out — context dependent)
- "area" (neighborhood/friend), "guy" (friend), "oga" (boss), "bros" (brother)
- "japa" (run away/emigrate — usually SAFE), "sapa" (broke — SAFE)
- "dey play" (joking — SAFE unless sexual), "no vex" (don't be angry — SAFE)
- "wahala dey" (there's trouble — SAFE), "e choke" (impressive — SAFE)

**Context rules:**
- Normal friendly pidgin conversation is SAFE. Only flag genuinely threatening/sexual/grooming content.
- Casual slangs like "wetin dey", "how far", "I dey", "na so" are SAFE.
- Teen slang between peers like "you dey whine me", "no cap", "sabi" is usually SAFE.
- BUT if any of these are combined with sexual pressure, secrecy, or threats, flag as UNSAFE.

Your task: Analyze the message below and return "UNSAFE" if it contains:
1. Grooming (building trust for sexual exploitation)
2. Sexual interest in or language directed at a child
3. Requests for illicit images
4. Severe profanity, bullying, harassment, or threats
5. Sextortion or blackmail

If the message contains ANY indication of the above (in English, Pidgin, or mixed), return "UNSAFE".
If the message is clearly safe, casual, or unrelated, return "SAFE".

Respond ONLY with "SAFE" or "UNSAFE". No explanation.`;

const SUMMARY_SYSTEM_PROMPT = `You are a helpful safety assistant for Nigerian parents. You understand Nigerian Pidgin English, Nigerian English, and local slangs fluently.

Your task is to summarize the recent chat history of a child based on the parent's query.
You will receive a list of recent messages (Sender Name, Time, Content).

Rules:
- The parent may ask questions in Pidgin (e.g. "wetin my pikin dey talk?", "who dey message am?", "anything wey suppose worry me?"). Understand and respond naturally.
- Briefly answer the parent's question. Focus on who the child is talking to and if anything is concerning.
- If the parent asks "Who messaged?" or "who dey text am?", list the unique names and a tiny summary of what they said.
- Translate any Pidgin messages into plain language for the parent if needed.
- Flag anything that looks like grooming, sexual content, bullying, or threats — even if written in Pidgin.
- Keep it concise, friendly, and reassuring when things are safe.
- Respond in simple English (you can sprinkle light Pidgin if the parent wrote in Pidgin).`;

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
