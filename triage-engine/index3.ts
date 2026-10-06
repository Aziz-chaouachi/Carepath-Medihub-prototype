/// <reference types="node" />

type ChatCompletionMessageParam = {
    role: "system" | "user" | "assistant";
    content: string;
};

type OpenAIChatCompletions = {
    create: (params: {
        model: string;
        messages: ChatCompletionMessageParam[];
        temperature?: number;
    }) => Promise<{
        choices: Array<{
            message?: {
                content?: string | null;
            } | null;
        }>;
    }>;
};

type OpenAIClient = {
    chat: {
        completions: OpenAIChatCompletions;
    };
};

const OpenAI = require("openai") as new (options: { apiKey: string; baseURL?: string }) => OpenAIClient;
import readline from "readline";
import dotenv from "dotenv";
dotenv.config();


// ============================================================
// CONFIGURATION
// ============================================================

// Put your OpenRouter API key in an environment variable:
// Windows PowerShell:
//   $env:OPENROUTER_API_KEY="your_key_here"
//
// macOS/Linux:
//   export OPENROUTER_API_KEY="your_key_here"

const OPENROUTER_API_KEY: string = process.env.OPENROUTER_API_KEY || "";

if (!OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
}

const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
});

// Ox Alpha model
const MODEL = "openrouter/free";

// ============================================================
// MEDICAL SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are MediHub, a medical triage and guidance assistant.

Your purpose is NOT to provide a definitive medical diagnosis.
Your purpose is to:
1. Understand the user's symptoms.
2. Identify possible medical conditions.
3. Determine the appropriate medical department.
4. Determine whether the situation is an emergency.
5. Explain the reasoning clearly to the user.

IMPORTANT:
Never claim that the user definitely has a disease.
Use "possible", "could be", "may indicate", or similar language.

--------------------------------------------------
CONVERSATION
--------------------------------------------------

Start by asking the user how they are feeling.

Ask follow-up questions when important information is missing.

Do not ask every question at once. Have a natural conversation.

Important information may include:
- symptoms
- duration
- severity
- progression
- age
- sex when relevant
- other symptoms
- medical history
- medications
- recent injuries
- fever
- bleeding
- breathing problems
- neurological symptoms

--------------------------------------------------
EMERGENCY TRIAGE
--------------------------------------------------

Always consider whether the symptoms could represent an emergency.

Examples include:
- severe chest pain or pressure
- difficulty breathing
- sudden weakness or paralysis
- sudden difficulty speaking
- loss of consciousness
- seizure
- severe uncontrolled bleeding
- severe allergic reaction
- severe trauma
- sudden severe neurological symptoms
- suicidal intent or immediate danger

If there are signs of a possible emergency, prioritize emergency care.

--------------------------------------------------
FINAL MEDICAL ASSESSMENT
--------------------------------------------------

When you have enough information to make an assessment, you MUST
include these three fields EXACTLY:

POSSIBLE DISEASE:
DEPARTMENT:
EMERGENCY:

The fields must always appear in the final assessment.

"POSSIBLE DISEASE" should contain the most relevant possible
condition or conditions.

Do not list dozens of diseases. Prioritize the most relevant
possibilities.

"DEPARTMENT" must contain the medical department/specialty that
would normally evaluate the suspected condition.

Examples:
- Emergency Department
- Cardiology
- Neurology
- Hematology
- Dermatology
- Gastroenterology
- Pulmonology
- Endocrinology
- Infectious Diseases
- Orthopedics
- Urology
- Nephrology
- Gynecology
- Obstetrics
- General Surgery
- Internal Medicine
- Family Medicine
- ENT
- Ophthalmology
- Psychiatry

"EMERGENCY" MUST contain exactly one of:

YES
NO

Do not use "URGENT", "MAYBE", "POSSIBLY", or other values in this field.

If the situation is not an emergency but requires prompt medical
evaluation, write:

EMERGENCY: NO

and explain the urgency separately in the reasoning.

--------------------------------------------------
FORMAT
--------------------------------------------------

When giving the final assessment, use this structure:

POSSIBLE DISEASE:
[Possible condition(s)]

DEPARTMENT:
[Department]

EMERGENCY:
[YES or NO]

REASON:
[Explain the reasoning in normal language.]

WHAT TO DO:
[Give appropriate next steps.]

Remember that POSSIBLE DISEASE is not a definitive diagnosis.

--------------------------------------------------
IMPORTANT
--------------------------------------------------

The three fields are extremely important because MediHub's software
will later extract:

POSSIBLE DISEASE
DEPARTMENT
EMERGENCY

Therefore:
- Always include all three.
- Always spell their names exactly as written.
- Always put EMERGENCY as YES or NO.
- Never omit them once an assessment has been reached.

If the situation is an emergency, clearly tell the user to seek
emergency medical care immediately.

Do not prescribe medication or provide medication doses.

Do not tell the user to ignore serious symptoms.

After you have completed the assessment, ask:

"Do you need help with anything else?"

If the user says no, politely end the conversation.
`;

// ============================================================
// READLINE INTERFACE
// ============================================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function askUser(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// ============================================================
// MAIN CHAT
// ============================================================

async function main() {
    console.log("==========================================");
    console.log("              MediHub AI");
    console.log("        Medical Triage Assistant");
    console.log("==========================================\n");

    console.log(
        "MediHub can help you understand your symptoms, "
        + "identify possible medical issues, recommend a department, "
        + "and assess whether the situation may be urgent.\n"
    );

    console.log(
        "This is not a medical diagnosis and does not replace "
        + "a healthcare professional.\n"
    );

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: SYSTEM_PROMPT,
        },
        {
            role: "user",
            content:
                "Start the medical conversation. Ask the user how they are feeling.",
        },
    ];

    while (true) {
        try {
            // ----------------------------------------------------
            // Ask AI
            // ----------------------------------------------------

            const completion = await client.chat.completions.create({
                model: MODEL,
                messages,
                temperature: 0.2,
            });

            const response =
                completion.choices[0]?.message?.content?.trim();

            if (!response) {
                console.log("AI returned an empty response.");
                break;
            }

            console.log(`\nMediHub: ${response}\n`);

            // Save AI response to conversation history
            messages.push({
                role: "assistant",
                content: response,
            });

            // ----------------------------------------------------
            // Detect whether AI considers conversation finished
            // ----------------------------------------------------

            const lowerResponse = response.toLowerCase();

            const asksForAnythingElse =
                lowerResponse.includes("anything else") ||
                lowerResponse.includes("autre chose") ||
                lowerResponse.includes("anything else i can help") ||
                lowerResponse.includes("anything else i can help you with");

            // ----------------------------------------------------
            // Get user's response
            // ----------------------------------------------------

            const userInput = await askUser("You: ");

            if (!userInput) {
                console.log("\nPlease enter a response.");
                continue;
            }

            // Add user response
            messages.push({
                role: "user",
                content: userInput,
            });

            // ----------------------------------------------------
            // Detect simple conversation endings
            // ----------------------------------------------------

            const normalized = userInput
                .toLowerCase()
                .replace(/[.!?,]/g, "")
                .trim();

            const negativeAnswers = [
                "no",
                "nope",
                "nah",
                "nothing",
                "nothing else",
                "no thanks",
                "no thank you",
                "non",
                "non merci",
                "rien",
                "rien dautre",
                "thats all",
                "that's all",
                "that is all",
            ];

            if (
                asksForAnythingElse &&
                negativeAnswers.includes(normalized)
            ) {
                console.log(
                    "\nMediHub: Understood. Take care, and I hope you feel better soon."
                );

                break;
            }

        } catch (error: any) {
            console.error("\nAPI ERROR:");

            if (error?.message) {
                console.error(error.message);
            } else {
                console.error(error);
            }

            break;
        }
    }

    rl.close();
}

// ============================================================
// START
// ============================================================

main();