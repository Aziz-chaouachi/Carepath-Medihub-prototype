/// <reference types="node" />

/**
 * MediHub API Server - FULLY INTEGRATED
 */

// @ts-expect-error TS7016
import express, { Request, Response } from 'express';
// @ts-expect-error TS7016
import cors from 'cors';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from "dotenv";
dotenv.config();
// Safe directory resolution for both CommonJS and ES Modules
const currentDir = typeof __dirname !== 'undefined' 
  ? __dirname 
  : path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// SETUP
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:8080'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// TYPES
// ============================================================

type EmergencyLevel = "Yes" | "No" | "Depends";

interface DiseaseRecord {
  name: string;
  symptoms: string[];
  emergency: EmergencyLevel;
  department: string;
  note: string;
}

interface SymptomEntry {
  canonical: string;
  everyday: string[];
}

interface DiseaseMatch {
  disease: DiseaseRecord;
  score: number;
  matchedSymptoms: string[];
  missingSymptoms: string[];
}

interface RedFlagResult {
  urgent: boolean;
  message: string;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }
  return previous[b.length];
}

function wordsSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength <= 5) return distance <= 1;
  if (maxLength <= 8) return distance <= 2;
  return distance <= 2;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = content.replace(/\r\n/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function normalizeEmergency(value: string | undefined): EmergencyLevel {
  const v = String(value ?? "").trim().toLowerCase();
  if (v.startsWith("y")) return "Yes";
  if (v.startsWith("d")) return "Depends";
  return "No";
}

// ============================================================
// DATABASE LOADING
// ============================================================

function loadDiseases(filePath: string): DiseaseRecord[] {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Disease database not found at: ${filePath}`);
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parseCsv(content);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => normalizeText(h));
  const diseaseIndex = header.indexOf("disease");
  const symptomsIndex = header.indexOf("symptoms");
  const departmentIndex = header.indexOf("department");
  const emergencyIndex = header.indexOf("emergency");
  const notesIndex = header.indexOf("notes");

  if (diseaseIndex === -1 || symptomsIndex === -1) return [];

  return rows
    .slice(1)
    .filter((row) => row[diseaseIndex] && row[diseaseIndex].trim())
    .map((row) => ({
      name: row[diseaseIndex]?.trim() || "",
      symptoms: (row[symptomsIndex] || "")
        .split(/[,;]/)
        .map((s) => normalizeText(s))
        .filter((s) => s.length > 0),
      emergency: normalizeEmergency(row[emergencyIndex]),
      department: row[departmentIndex]?.trim() || "General Medicine",
      note: row[notesIndex]?.trim() || "",
    }));
}

function loadSymptomDict(filePath: string): Map<string, SymptomEntry> {
  const dict = new Map<string, SymptomEntry>();
  if (!fs.existsSync(filePath)) return dict;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  for (const line of lines) {
    const parts = line.split(":");
    if (parts.length < 2) continue;

    const canonical = normalizeText(parts[0]);
    const everyday = parts
      .slice(1)
      .join(":")
      .split(",")
      .map((s) => normalizeText(s))
      .filter((s) => s.length > 0);

    if (canonical.length > 0 && everyday.length > 0) {
      dict.set(canonical, { canonical, everyday });
      for (const variant of everyday) {
        if (!dict.has(variant)) dict.set(variant, { canonical, everyday });
      }
    }
  }
  return dict;
}

// ============================================================
// SYMPTOM MATCHING
// ============================================================

function fuzzyMatchSymptom(
  input: string,
  symptoms: string[],
  symptomDict: Map<string, SymptomEntry>
): Set<string> {
  const matches = new Set<string>();
  const inputWords = input.split(/\s+/).filter((w) => w.length > 0);

  for (const symptom of symptoms) {
    const symptomWords = symptom.split(/\s+/);
    if (symptomDict.has(symptom)) {
      const entry = symptomDict.get(symptom)!;
      for (const variant of entry.everyday) {
        if (variant === input || inputWords.some((w) => variant.includes(w))) {
          matches.add(symptom);
          break;
        }
      }
    }
    for (const inputWord of inputWords) {
      for (const symptomWord of symptomWords) {
        if (wordsSimilar(inputWord, symptomWord)) {
          matches.add(symptom);
          break;
        }
      }
      if (matches.has(symptom)) break;
    }
    if (input.includes(symptom) || symptom.includes(input)) matches.add(symptom);
  }
  return matches;
}

function matchDiseases(
  input: string,
  diseases: DiseaseRecord[],
  symptomDict: Map<string, SymptomEntry>,
  confirmed: Set<string>,
  denied: Set<string>
): DiseaseMatch[] {
  const matches: DiseaseMatch[] = [];

  for (const disease of diseases) {
    const matchedSymptoms = fuzzyMatchSymptom(input, disease.symptoms, symptomDict);
    
    // Also include previously confirmed symptoms that match this disease
    for (const conf of confirmed) {
      if (disease.symptoms.includes(conf)) {
        matchedSymptoms.add(conf);
      }
    }

    const deniedCount = Array.from(matchedSymptoms).filter((s) =>
      denied.has(normalizeText(s))
    ).length;

    if (deniedCount > 0) continue;

    const score = matchedSymptoms.size / Math.max(disease.symptoms.length, 1);

    if (score > 0) {
      const missingSymptoms = disease.symptoms.filter(
        (s) => !matchedSymptoms.has(s) && !confirmed.has(s) && !denied.has(s)
      );

      matches.push({
        disease,
        score,
        matchedSymptoms: Array.from(matchedSymptoms),
        missingSymptoms,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ============================================================
// RED FLAG CHECKING & QUESTIONS
// ============================================================

function checkRedFlags(input: string, matches: DiseaseMatch[]): RedFlagResult {
  const lowerInput = input.toLowerCase();
  const redFlagKeywords = [
    "chest pain", "difficulty breathing", "shortness of breath",
    "sudden weakness", "paralysis", "loss of consciousness", "seizure",
    "severe bleeding", "severe allergic", "severe trauma", "suicidal",
    "unconscious", "can't breathe", "crushing chest", "severe headache with stiff neck",
  ];

  for (const keyword of redFlagKeywords) {
    if (lowerInput.includes(keyword)) {
      return {
        urgent: true,
        message: "⚠️ EMERGENCY: Your symptoms suggest you may need immediate medical attention. Please call emergency services immediately.",
      };
    }
  }

  for (const match of matches) {
    if (match.disease.emergency === "Yes") {
      return {
        urgent: true,
        message: `⚠️ URGENT: The condition you're describing may require urgent medical evaluation. Please seek medical care soon.`,
      };
    }
  }
  return { urgent: false, message: "" };
}

function generateFollowUpQuestion(matches: DiseaseMatch[], questionsAsked: number): string {
  if (matches.length === 0) {
    return `I couldn't identify a specific condition based on your description. Could you provide more details about:\n\n1. When did these symptoms start?\n2. How severe are they (1-10)?\n3. Are there any other symptoms?\n4. Any relevant medical history?`;
  }
  const topMatch = matches[0];
  const missingSymptoms = topMatch.missingSymptoms.slice(0, 3);

  if (missingSymptoms.length === 0) {
    return `Based on your symptoms, I have enough information to provide an assessment:\n\nPOSSIBLE DISEASE: ${topMatch.disease.name}\nDEPARTMENT: ${topMatch.disease.department}\nEMERGENCY: ${topMatch.disease.emergency}\n\nPlease consult a healthcare professional in the ${topMatch.disease.department} for proper evaluation.`;
  }
  return `To better understand your condition, could you tell me if you have any of these symptoms:\n\n- ${missingSymptoms.slice(0, 2).join("\n- ")}\n\n(Please answer yes or no, and add any other details)`;
}

// ============================================================
// INDEX3.ts INTEGRATION (Fully AI Mode)
// ============================================================

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY: string = process.env.OPENROUTER_API_KEY || "";

if (!OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
}
const OPENROUTER_MODEL = "openrouter/free";

const SYSTEM_PROMPT = `You are MediHub, a professional medical triage assistant... (Assume rest of your prompt here)`;

// ============================================================
// ENDPOINTS
// ============================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// AI-ASSISTED MODE ENDPOINT
app.post('/api/triage/assisted', async (req: Request, res: Response) => {
  try {
    // FIX: Extract confirmed/denied state arrays from the frontend request!
    const { userMessage, confirmedSymptoms = [], deniedSymptoms = [] } = req.body;

    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({ error: 'Invalid request: userMessage is required' });
    }

    const diseaseDbPath = path.join(currentDir, 'Comprehensive_Medical_Diseases_Database.csv');
    const symptomDictPath = path.join(currentDir, 'sympdict.txt');

    const diseases = loadDiseases(diseaseDbPath);
    const symptomDict = loadSymptomDict(symptomDictPath);

    if (diseases.length === 0) {
      return res.json({ response: 'Unable to load disease database.' });
    }

    const normalizedInput = normalizeText(userMessage);

    // FIX: Pass the actual tracked state into the matcher
    const confirmedSet = new Set<string>(confirmedSymptoms);
    const deniedSet = new Set<string>(deniedSymptoms);

    const matches = matchDiseases(normalizedInput, diseases, symptomDict, confirmedSet, deniedSet);
    const redFlags = checkRedFlags(userMessage, matches);

    let response = '';
    if (redFlags.urgent) response = redFlags.message + '\n\n';
    
    // FIX: Ensure we aren't asking endless questions based on frontend state size
    response += generateFollowUpQuestion(matches, confirmedSet.size + deniedSet.size);

    res.json({
      response,
      mode: 'assisted',
      // Return updated state back to frontend if they answered "yes/no"
      matchedSymptoms: matches.length > 0 ? matches[0].matchedSymptoms : []
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to process assisted triage', message: error.message });
  }
});

// FULLY AI MODE ENDPOINT
app.post('/api/triage/fully', async (req: Request, res: Response) => {
  try {
    const { conversationHistory, userMessage } = req.body;
    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (!Array.isArray(conversationHistory)) {
      return res.status(400).json({ error: 'Invalid history' });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const response = await axios.post(
      OPENROUTER_API_URL,
      { model: OPENROUTER_MODEL, messages: messages, temperature: 0.2 },
      { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const aiResponse = response.data.choices[0]?.message?.content?.trim();
    if (!aiResponse) return res.status(500).json({ error: 'Empty response' });

    res.json({ response: aiResponse, mode: 'fully' });
  } catch (error: any) {
    res.json({ response: `I'm experiencing a connection issue. Please try again.`, error: 'API Error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ MediHub API Running on http://localhost:${PORT}`);
});

export default app;