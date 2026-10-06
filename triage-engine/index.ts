/**
 * MediHub Triage Engine
 *
 * Run:
 *   npx tsx index.ts
 *
 * Files:
 *   Comprehensive_Medical_Diseases_Database.csv
 *   sympdict.txt
 *
 * IMPORTANT:
 * - The disease CSV is the medical source of truth.
 * - The symptom dictionary provides language variants.
 * - AI is ONLY used to normalize user language.
 * - AI does NOT diagnose.
 * - AI does NOT determine emergency level.
 */

/// <reference types="node" />

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import dotenv from "dotenv";
dotenv.config();

// ============================================================
// CONFIG
// ============================================================

const DB_PATH = path.join(
  __dirname,
  "Comprehensive_Medical_Diseases_Database.csv"
);

const DICT_PATH = path.join(
  __dirname,
  "sympdict.txt"
);

const MAX_QUESTIONS = 12;

const OPENROUTER_API_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_API_KEY: string = process.env.OPENROUTER_API_KEY || "";

if (!OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
}
/**
 * OpenRouter currently provides this router for free models.
 */
const OPENROUTER_MODEL = "openrouter/free";

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

interface EngineState {
  confirmed: Set<string>;
  denied: Set<string>;
  asked: Set<string>;
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
// TEXT NORMALIZATION
// ============================================================

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// LEVENSHTEIN DISTANCE
// ============================================================

function levenshtein(
  a: string,
  b: string
): number {
  if (a === b) return 0;

  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous: number[] = [];

  for (let j = 0; j <= b.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];

    for (let j = 1; j <= b.length; j++) {
      const cost =
        a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

// ============================================================
// FUZZY WORD MATCHING
// ============================================================

function wordsSimilar(
  a: string,
  b: string
): boolean {
  if (a === b) return true;

  // Very short words should not be fuzzy matched.
  if (a.length < 4 || b.length < 4) {
    return false;
  }

  const distance = levenshtein(a, b);

  const maxLength = Math.max(
    a.length,
    b.length
  );

  if (maxLength <= 5) {
    return distance <= 1;
  }

  if (maxLength <= 8) {
    return distance <= 2;
  }

  return distance <= 2;
}

// ============================================================
// CSV PARSER
// ============================================================

function parseCsv(
  content: string
): string[][] {
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const text =
    content.replace(/\r\n/g, "\n");

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

  if (
    field.length > 0 ||
    row.length > 0
  ) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) =>
    r.some(
      (cell) =>
        cell.trim().length > 0
    )
  );
}

// ============================================================
// EMERGENCY NORMALIZATION
// ============================================================

function normalizeEmergency(
  value: string | undefined
): EmergencyLevel {
  const v =
    String(value ?? "")
      .trim()
      .toLowerCase();

  if (v.startsWith("y")) {
    return "Yes";
  }

  if (v.startsWith("d")) {
    return "Depends";
  }

  return "No";
}

// ============================================================
// LOAD DISEASE DATABASE
// ============================================================

function loadDiseases(
  filePath: string
): DiseaseRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Disease database not found:\n${filePath}`
    );
  }

  const content =
    fs.readFileSync(
      filePath,
      "utf-8"
    );

  const rows =
    parseCsv(content);

  if (rows.length === 0) {
    throw new Error(
      "Disease database is empty."
    );
  }

  const header =
    rows[0].map((h) =>
      normalizeText(h)
    );

  const diseaseIndex =
    header.indexOf("disease");

  const symptomsIndex =
    header.indexOf("symptoms");

  const departmentIndex =
    header.indexOf("department");

  const emergencyIndex =
    header.indexOf("emergency");

  const notesIndex =
    header.indexOf("notes");

  if (
    diseaseIndex === -1 ||
    symptomsIndex === -1
  ) {
    throw new Error(
      "CSV must contain Disease and Symptoms columns."
    );
  }

  return rows
    .slice(1)
    .filter(
      (row) =>
        row[diseaseIndex] &&
        row[diseaseIndex].trim()
    )
    .map((row) => ({
      name:
        row[diseaseIndex].trim(),

      symptoms:
        (row[symptomsIndex] || "")
          .split(",")
          .map(normalizeText)
          .filter(Boolean),

      department:
        departmentIndex >= 0
          ? (
              row[departmentIndex] ||
              "General Medicine"
            ).trim()
          : "General Medicine",

      emergency:
        emergencyIndex >= 0
          ? normalizeEmergency(
              row[emergencyIndex]
            )
          : "No",

      note:
        notesIndex >= 0
          ? (
              row[notesIndex] || ""
            ).trim()
          : "",
    }));
}

// ============================================================
// LOAD YOUR SYMPTOM DICTIONARY
//
// Supports:
// canonical -> everyday language
//
// Example:
// tiredness -> tiredness
// bone and joint pain -> bone and pain in a joint
// ============================================================

function loadSymptomDictionary(
  filePath: string
): Map<string, SymptomEntry> {
  const dictionary =
    new Map<string, SymptomEntry>();

  if (!fs.existsSync(filePath)) {
    console.warn(
      `[Warning] Symptom dictionary not found: ${filePath}`
    );

    return dictionary;
  }

  const content =
    fs.readFileSync(
      filePath,
      "utf-8"
    );

  for (
    const rawLine of content.split("\n")
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("->")
    ) {
      continue;
    }

    const arrow =
      line.indexOf("->");

    const canonical =
      normalizeText(
        line.slice(0, arrow)
      );

    const everyday =
      normalizeText(
        line.slice(arrow + 2)
      );

    if (!canonical) {
      continue;
    }

    const existing =
      dictionary.get(canonical);

    if (existing) {
      if (
        everyday &&
        !existing.everyday.includes(
          everyday
        )
      ) {
        existing.everyday.push(
          everyday
        );
      }
    } else {
      dictionary.set(
        canonical,
        {
          canonical,
          everyday: everyday
            ? [everyday]
            : [],
        }
      );
    }
  }

  return dictionary;
}

// ============================================================
// ALL CANONICAL SYMPTOMS
// ============================================================

function getAllCanonicalSymptoms(
  diseases: DiseaseRecord[]
): Set<string> {
  const result =
    new Set<string>();

  for (const disease of diseases) {
    for (const symptom of disease.symptoms) {
      result.add(
        normalizeText(symptom)
      );
    }
  }

  return result;
}

// ============================================================
// SYMPTOM ALIAS INDEX
// ============================================================

function buildAliasIndex(
  dictionary: Map<string, SymptomEntry>,
  canonicalSymptoms: Set<string>
): Map<string, string> {
  const aliases =
    new Map<string, string>();

  // Database symptoms
  for (
    const canonical of canonicalSymptoms
  ) {
    aliases.set(
      canonical,
      canonical
    );
  }

  // Dictionary
  for (
    const [canonical, entry] of dictionary
  ) {
    aliases.set(
      canonical,
      canonical
    );

    for (
      const everyday of entry.everyday
    ) {
      if (everyday) {
        aliases.set(
          everyday,
          canonical
        );
      }
    }
  }

  return aliases;
}

// ============================================================
// SPECIAL NATURAL-LANGUAGE ALIASES
//
// These are not diagnoses.
// They simply handle everyday phrasing that your
// dictionary may not explicitly contain.
// ============================================================

const COMMON_ALIASES: Record<
  string,
  string[]
> = {
  "chest pain": [
    "pain in chest",
    "pain in my chest",
    "my chest hurts",
    "chest hurts",
    "chest pain",
    "pain in the chest",
  ],

  "left arm pain": [
    "pain in left arm",
    "pain in my left arm",
    "my left arm hurts",
    "left arm hurts",
    "left arm pain",
  ],

  "right arm pain": [
    "pain in right arm",
    "pain in my right arm",
    "my right arm hurts",
    "right arm hurts",
    "right arm pain",
  ],

  "loss of appetite": [
    "no appetite",
    "dont have appetite",
    "do not have appetite",
    "don't have appetite",
    "not hungry",
    "poor appetite",
    "decreased appetite",
    "loss of appetite",
  ],

  fatigue: [
    "tired",
    "tiredness",
    "very tired",
    "really tired",
    "feeling tired",
    "exhausted",
    "exhaustion",
    "no energy",
    "low energy",
    "lack of energy",
  ],

  bruising: [
    "bruises",
    "bruising",
    "bruised",
    "easy bruising",
    "getting bruises",
    "lots of bruises",
  ],

  fever: [
    "fever",
    "feverish",
    "high temperature",
    "high temp",
    "temperature",
  ],

  "knee pain": [
    "pain in knee",
    "pain in knees",
    "pain in my knee",
    "pain in my knees",
    "my knee hurts",
    "my knees hurt",
    "knee hurts",
    "knees hurt",
    "knee pain",
    "knees pain",
  ],

  "bone pain": [
    "pain in bones",
    "bone pain",
    "my bones hurt",
    "bones hurt",
  ],
};

// ============================================================
// CANONICAL RESOLUTION
//
// Critical design:
// We don't blindly trust an AI-generated symptom.
// We resolve it against YOUR database/dictionary.
// ============================================================

function resolveCanonical(
  phrase: string,
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): string | null {
  const normalized =
    normalizeText(phrase);

  if (!normalized) {
    return null;
  }

  // Exact canonical
  if (
    canonicalSymptoms.has(
      normalized
    )
  ) {
    return normalized;
  }

  // Exact alias
  const exact =
    aliases.get(normalized);

  if (exact) {
    return exact;
  }

  // Common alias
  for (
    const [canonical, variants]
    of Object.entries(COMMON_ALIASES)
  ) {
    if (
      normalized ===
      normalizeText(canonical)
    ) {
      return findBestDatabaseCanonical(
        canonical,
        aliases,
        canonicalSymptoms
      );
    }

    for (const variant of variants) {
      if (
        normalized ===
        normalizeText(variant)
      ) {
        return findBestDatabaseCanonical(
          canonical,
          aliases,
          canonicalSymptoms
        );
      }
    }
  }

  // Containment
  for (
    const [alias, canonical]
    of aliases
  ) {
    if (
      alias.length >= 5 &&
      (
        normalized.includes(alias) ||
        alias.includes(normalized)
      )
    ) {
      return canonical;
    }
  }

  // Fuzzy single phrase
  const words =
    normalized.split(" ");

  let best:
    | {
        canonical: string;
        score: number;
      }
    | null = null;

  for (
    const [alias, canonical]
    of aliases
  ) {
    if (
      alias.length < 4
    ) {
      continue;
    }

    const aliasWords =
      alias.split(" ");

    // Single-word typo
    if (
      words.length === 1 &&
      aliasWords.length === 1
    ) {
      if (
        wordsSimilar(
          words[0],
          aliasWords[0]
        )
      ) {
        const score =
          1 -
          levenshtein(
            words[0],
            aliasWords[0]
          ) /
            Math.max(
              words[0].length,
              aliasWords[0].length
            );

        if (
          !best ||
          score > best.score
        ) {
          best = {
            canonical,
            score,
          };
        }
      }
    }
  }

  if (
    best &&
    best.score >= 0.72
  ) {
    return best.canonical;
  }

  return null;
}

// ============================================================
// FIND BEST DATABASE CANONICAL FOR COMMON ALIAS
// ============================================================

function findBestDatabaseCanonical(
  commonCanonical: string,
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): string | null {
  const normalized =
    normalizeText(
      commonCanonical
    );

  // Exact
  if (
    canonicalSymptoms.has(
      normalized
    )
  ) {
    return normalized;
  }

  // Search canonical symptoms
  let best:
    | {
        canonical: string;
        score: number;
      }
    | null = null;

  const targetWords =
    normalized.split(" ");

  for (
    const candidate
    of canonicalSymptoms
  ) {
    const candidateWords =
      candidate.split(" ");

    let matched = 0;

    for (
      const targetWord
      of targetWords
    ) {
      if (
        candidateWords.some(
          (candidateWord) =>
            candidateWord ===
              targetWord ||
            wordsSimilar(
              candidateWord,
              targetWord
            )
        )
      ) {
        matched++;
      }
    }

    if (matched === 0) {
      continue;
    }

    const score =
      matched /
      Math.max(
        targetWords.length,
        candidateWords.length
      );

    if (
      !best ||
      score > best.score
    ) {
      best = {
        canonical: candidate,
        score,
      };
    }
  }

  if (
    best &&
    best.score >= 0.5
  ) {
    return best.canonical;
  }

  // Search aliases
  for (
    const [alias, canonical]
    of aliases
  ) {
    if (
      alias.includes(normalized) ||
      normalized.includes(alias)
    ) {
      return canonical;
    }
  }

  return null;
}

// ============================================================
// LOCAL SYMPTOM EXTRACTION
// ============================================================

function extractLocalSymptoms(
  text: string,
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): string[] {
  const input =
    normalizeText(text);

  const found =
    new Set<string>();

  // ----------------------------------------------------------
  // 1. Exact phrase matching
  // ----------------------------------------------------------

  const aliasList =
    Array.from(
      aliases.entries()
    ).sort(
      (a, b) =>
        b[0].length -
        a[0].length
    );

  for (
    const [phrase, canonical]
    of aliasList
  ) {
    if (
      phrase.length < 3
    ) {
      continue;
    }

    const regex =
      new RegExp(
        `\\b${escapeRegex(
          phrase
        )}\\b`,
        "i"
      );

    if (
      regex.test(input)
    ) {
      found.add(
        canonical
      );
    }
  }

  // ----------------------------------------------------------
  // 2. Common aliases
  // ----------------------------------------------------------

  for (
    const [common, variants]
    of Object.entries(
      COMMON_ALIASES
    )
  ) {
    const allPhrases = [
      common,
      ...variants,
    ];

    for (
      const phrase
      of allPhrases
    ) {
      const normalized =
        normalizeText(
          phrase
        );

      const regex =
        new RegExp(
          `\\b${escapeRegex(
            normalized
          )}\\b`,
          "i"
        );

      if (
        regex.test(input)
      ) {
        const canonical =
          findBestDatabaseCanonical(
            common,
            aliases,
            canonicalSymptoms
          );

        if (canonical) {
          found.add(
            canonical
          );
        }

        break;
      }
    }
  }

  // ----------------------------------------------------------
  // 3. Typo correction
  //
  // Example:
  // hcest -> chest
  // ----------------------------------------------------------

  const words =
    input.split(" ");

  for (
    const word of words
  ) {
    if (
      word.length < 4
    ) {
      continue;
    }

    for (
      const canonical
      of canonicalSymptoms
    ) {
      const canonicalWords =
        canonical.split(" ");

      for (
        const candidateWord
        of canonicalWords
      ) {
        if (
          wordsSimilar(
            word,
            candidateWord
          )
        ) {
          // Only accept a typo when it is
          // reasonably close.
          const distance =
            levenshtein(
              word,
              candidateWord
            );

          const similarity =
            1 -
            distance /
              Math.max(
                word.length,
                candidateWord.length
              );

          if (
            similarity >= 0.78
          ) {
            found.add(
              canonical
            );
          }
        }
      }
    }
  }

  return removeDuplicates(
    Array.from(found)
  );
}

// ============================================================
// DEDUPLICATION
// ============================================================

function removeDuplicates(
  symptoms: string[]
): string[] {
  return Array.from(
    new Set(
      symptoms.map(normalizeText)
    )
  );
}

// ============================================================
// AI NORMALIZATION
// ============================================================

async function extractSymptomsViaAI(
  userText: string,
  candidateSymptoms: string[]
): Promise<string[]> {
  if (
    !OPENROUTER_API_KEY ||
    OPENROUTER_API_KEY ===
      "PUT_YOUR_OPENROUTER_KEY_HERE"
  ) {
    return [];
  }

  /**
   * Don't send all 2,044 symptoms.
   *
   * Local matching first creates a smaller candidate list.
   */
  const candidates =
    candidateSymptoms
      .slice(0, 80);

  try {
    const response =
      await fetch(
        OPENROUTER_API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${OPENROUTER_API_KEY}`,

            "HTTP-Referer":
              "http://localhost",

            "X-Title":
              "MediHub Triage Engine",
          },

          body: JSON.stringify({
            model:
              OPENROUTER_MODEL,

            temperature: 0,

            max_tokens: 300,

            messages: [
              {
                role: "system",

                content: `
You are a symptom normalization component.

You are NOT a doctor.
You MUST NOT diagnose.
You MUST NOT recommend a disease.
You MUST NOT infer symptoms that were not stated.

Your only task is:

USER LANGUAGE
→ canonical symptom names.

The canonical symptom names below come from the application's
medical database.

You may ONLY return symptoms from this list.

CANONICAL SYMPTOMS:
${candidates.join("\n")}

Rules:

1. Correct obvious spelling mistakes.
2. Understand ordinary English.
3. "I am tired" can map to a fatigue/tiredness canonical
   symptom IF that canonical exists in the list.
4. "my knees hurt" can map to a knee pain canonical
   symptom IF it exists.
5. "pain in my chest" must be represented as a chest-pain
   symptom if one exists.
6. Do not turn "chest pain" into the generic "ache".
7. Do not invent symptoms.
8. Do not return explanations.
9. Return JSON only.

Format:
{"symptoms":["canonical symptom 1","canonical symptom 2"]}

If nothing matches:
{"symptoms":[]}
                `.trim(),
              },

              {
                role: "user",
                content: userText,
              },
            ],
          }),
        }
      );

    if (
      !response.ok
    ) {
      const error =
        await response.text();

      console.warn(
        `\n[AI Warning] OpenRouter ${response.status}: ${error}`
      );

      return [];
    }

    const data =
      await response.json();

    const output =
      data?.choices?.[0]
        ?.message
        ?.content;

    if (
      typeof output !== "string"
    ) {
      return [];
    }

    // Remove possible markdown fences.
    const cleaned =
      output
        .replace(
          /```json/gi,
          ""
        )
        .replace(
          /```/g,
          ""
        )
        .trim();

    try {
      const parsed =
        JSON.parse(cleaned);

      if (
        !Array.isArray(
          parsed.symptoms
        )
      ) {
        return [];
      }

      return parsed.symptoms
        .map(
          (s: unknown) =>
            typeof s === "string"
              ? normalizeText(s)
              : ""
        )
        .filter(Boolean);
    } catch {
      console.warn(
        "[AI Warning] AI returned invalid JSON."
      );

      return [];
    }
  } catch {
    console.warn(
      "\n[AI Warning] OpenRouter unavailable. Local parser will be used."
    );

    return [];
  }
}

// ============================================================
// NORMALIZE AI RESULTS
// ============================================================

function normalizeAISymptoms(
  aiSymptoms: string[],
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): string[] {
  const result =
    new Set<string>();

  for (
    const symptom of aiSymptoms
  ) {
    const canonical =
      resolveCanonical(
        symptom,
        aliases,
        canonicalSymptoms
      );

    if (canonical) {
      result.add(
        canonical
      );
    }
  }

  return Array.from(result);
}

// ============================================================
// SYMPTOM FREQUENCY
// ============================================================

function calculateFrequency(
  diseases: DiseaseRecord[]
): Map<string, number> {
  const frequency =
    new Map<string, number>();

  for (
    const disease of diseases
  ) {
    const unique =
      new Set(
        disease.symptoms
      );

    for (
      const symptom of unique
    ) {
      frequency.set(
        symptom,
        (frequency.get(
          symptom
        ) ?? 0) + 1
      );
    }
  }

  return frequency;
}

// ============================================================
// WEIGHT
// ============================================================

function symptomWeight(
  symptom: string,
  frequency: Map<string, number>,
  totalDiseases: number
): number {
  const count =
    frequency.get(
      symptom
    ) ?? 1;

  const prevalence =
    count /
    Math.max(
      totalDiseases,
      1
    );

  if (
    prevalence >= 0.5
  ) {
    return 0.3;
  }

  if (
    prevalence >= 0.3
  ) {
    return 0.45;
  }

  if (
    prevalence >= 0.15
  ) {
    return 0.7;
  }

  if (
    prevalence >= 0.05
  ) {
    return 1.0;
  }

  return 1.3;
}

// ============================================================
// DISEASE SCORING
// ============================================================

function scoreDisease(
  disease: DiseaseRecord,
  state: EngineState,
  frequency: Map<string, number>,
  totalDiseases: number
): DiseaseMatch {
  const diseaseSymptoms =
    new Set(
      disease.symptoms.map(
        normalizeText
      )
    );

  let score = 0;

  const matched: string[] = [];
  const missing: string[] = [];

  // Confirmed
  for (
    const symptom
    of state.confirmed
  ) {
    if (
      diseaseSymptoms.has(
        symptom
      )
    ) {
      score +=
        symptomWeight(
          symptom,
          frequency,
          totalDiseases
        );

      matched.push(
        symptom
      );
    }
  }

  // Denied
  for (
    const symptom
    of state.denied
  ) {
    if (
      diseaseSymptoms.has(
        symptom
      )
    ) {
      score -= 1.25;
    }
  }

  // Missing
  for (
    const symptom
    of diseaseSymptoms
  ) {
    if (
      !state.confirmed.has(
        symptom
      ) &&
      !state.denied.has(
        symptom
      )
    ) {
      missing.push(
        symptom
      );
    }
  }

  // Multiple matching symptoms are stronger evidence.
  if (
    matched.length >= 2
  ) {
    score += 0.5;
  }

  if (
    matched.length >= 3
  ) {
    score += 0.35;
  }

  return {
    disease,
    score,
    matchedSymptoms:
      matched,
    missingSymptoms:
      missing,
  };
}

// ============================================================
// RANK
// ============================================================

function rankDiseases(
  diseases: DiseaseRecord[],
  state: EngineState,
  frequency: Map<string, number>
): DiseaseMatch[] {
  return diseases
    .map(
      (disease) =>
        scoreDisease(
          disease,
          state,
          frequency,
          diseases.length
        )
    )
    .filter(
      (match) =>
        match.score > 0 &&
        match.matchedSymptoms
          .length > 0
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    );
}

// ============================================================
// NEXT QUESTION
// ============================================================

function pickNextSymptom(
  matches: DiseaseMatch[],
  state: EngineState,
  frequency: Map<string, number>,
  totalDiseases: number
): string | null {
  const top =
    matches.slice(0, 12);

  const counts =
    new Map<string, number>();

  for (
    const match of top
  ) {
    for (
      const symptom
      of match.missingSymptoms
    ) {
      if (
        state.asked.has(
          symptom
        ) ||
        state.confirmed.has(
          symptom
        ) ||
        state.denied.has(
          symptom
        )
      ) {
        continue;
      }

      counts.set(
        symptom,
        (counts.get(
          symptom
        ) ?? 0) + 1
      );
    }
  }

  if (
    counts.size === 0
  ) {
    return null;
  }

  let best:
    | {
        symptom: string;
        score: number;
      }
    | null = null;

  for (
    const [symptom, count]
    of counts
  ) {
    const weight =
      symptomWeight(
        symptom,
        frequency,
        totalDiseases
      );

    const score =
      count * weight;

    if (
      !best ||
      score > best.score
    ) {
      best = {
        symptom,
        score,
      };
    }
  }

  return best?.symptom ?? null;
}

// ============================================================
// RED FLAG ENGINE
// ============================================================

/**
 * This layer runs BEFORE disease ranking.
 *
 * It is intentionally independent from the disease CSV.
 *
 * It does NOT say:
 * "you have a heart attack."
 *
 * It says:
 * "this symptom combination needs urgent assessment."
 */

function checkRedFlags(
  rawText: string,
  confirmed: Set<string>
): RedFlagResult {
  const text =
    normalizeText(
      rawText
    );

  // ----------------------------------------------------------
  // Chest pain + arm pain
  // ----------------------------------------------------------

  const hasChestPain =
    confirmed.has(
      "chest pain"
    ) ||
    /\bchest\b.*\b(pain|hurt|hurts|ache|pressure|tightness)\b/i.test(
      text
    ) ||
    /\b(pain|hurt|hurts|ache|pressure|tightness)\b.*\bchest\b/i.test(
      text
    );

  const hasArmPain =
    confirmed.has(
      "left arm pain"
    ) ||
    confirmed.has(
      "right arm pain"
    ) ||
    /\b(left|right)?\s*arm\b.*\b(pain|hurt|hurts|ache)\b/i.test(
      text
    ) ||
    /\b(pain|hurt|hurts|ache)\b.*\b(left|right)?\s*arm\b/i.test(
      text
    );

  if (
    hasChestPain &&
    hasArmPain
  ) {
    return {
      urgent: true,

      message:
        "Chest pain together with arm pain can sometimes indicate a serious medical problem. Please seek urgent medical assessment rather than relying on this self-check.",
    };
  }

  // ----------------------------------------------------------
  // Chest pain + shortness of breath
  // ----------------------------------------------------------

  const hasBreathingDifficulty =
    confirmed.has(
      "shortness of breath"
    ) ||
    /\b(short of breath|difficulty breathing|hard to breathe|can't breathe|cannot breathe|breathing trouble)\b/i.test(
      text
    );

  if (
    hasChestPain &&
    hasBreathingDifficulty
  ) {
    return {
      urgent: true,

      message:
        "Chest pain together with breathing difficulty can sometimes be serious. Please seek urgent medical assessment.",
    };
  }

  // ----------------------------------------------------------
  // Severe breathing difficulty
  // ----------------------------------------------------------

  if (
    hasBreathingDifficulty
  ) {
    return {
      urgent: true,

      message:
        "Significant difficulty breathing can require urgent medical attention. Please seek medical care immediately if you are struggling to breathe.",
    };
  }

  return {
    urgent: false,
    message: "",
  };
}

// ============================================================
// UI
// ============================================================

function pick<T>(
  array: T[]
): T {
  return array[
    Math.floor(
      Math.random() *
        array.length
    )
  ];
}

function say(
  text: string
): void {
  console.log(
    `\n${text}`
  );
}

const GREETINGS = [
  "Hi there!",
  "Hey!",
  "Hello!",
  "Hi!",
  "Hey, welcome.",
  "Hi, good to see you.",
];

const ASK = [
  "What's going on today?",
  "What brings you in today?",
  "What's been bothering you?",
  "How can I help you today?",
  "What's troubling you?",
];

const ASK_SYMPTOMS = [
  "Go ahead and describe what you're feeling, in your own words.",
  "Tell me what symptoms you've noticed.",
  "What symptoms are you experiencing right now?",
  "Can you walk me through what you're feeling?",
  "Describe it however feels natural, I'll take it from there.",
];

const QUESTIONS = [
  "Do you also have {s}?",
  "Have you noticed any {s}?",
  "Are you experiencing {s} as well?",
  "Any {s}?",
  "Would you say you have {s}?",
  "On top of that, any {s}?",
  "Quick one — {s}, yes or no?",
];

const GOOD = [
  "Okay, noted.",
  "Got it.",
  "Alright, thanks for letting me know.",
  "Understood.",
];

const BAD = [
  "Okay, noted.",
  "Alright, good to know.",
  "Got it, ruling that out.",
  "Okay, moving on.",
];

const GOODBYE = [
  "Take care of yourself!",
  "Wishing you a speedy recovery!",
  "Feel better soon!",
  "Take it easy, and don't hesitate to check back in.",
];

// ============================================================
// READLINE
// ============================================================

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

const askUser =
  (
    question: string
  ): Promise<string> =>
    new Promise(
      (resolve) =>
        rl.question(
          question,
          resolve
        )
    );

// ============================================================
// INITIAL SYMPTOMS
// ============================================================

async function gatherSymptoms(
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): Promise<{
  state: EngineState;
  rawText: string;
  redFlag: RedFlagResult;
}> {
  const state: EngineState = {
    confirmed: new Set(),
    denied: new Set(),
    asked: new Set(),
  };

  const rawText =
    await askUser(
      `\n${pick(
        ASK_SYMPTOMS
      )}\n> `
    );

  say(
    "Let me process that..."
  );

  // ----------------------------------------------------------
  // LOCAL FIRST
  // ----------------------------------------------------------

  const local =
    extractLocalSymptoms(
      rawText,
      aliases,
      canonicalSymptoms
    );

  // ----------------------------------------------------------
  // AI SECOND
  //
  // Give AI only likely candidates.
  // ----------------------------------------------------------

  const candidateSymptoms =
    Array.from(
      canonicalSymptoms
    );

  const ai =
    await extractSymptomsViaAI(
      rawText,
      candidateSymptoms
    );

  const normalizedAI =
    normalizeAISymptoms(
      ai,
      aliases,
      canonicalSymptoms
    );

  // ----------------------------------------------------------
  // MERGE
  // ----------------------------------------------------------

  const combined =
    removeDuplicates([
      ...local,
      ...normalizedAI,
    ]);

  for (
    const symptom
    of combined
  ) {
    state.confirmed.add(
      symptom
    );
  }

  if (
    combined.length > 0
  ) {
    say(
      `Okay, I picked up on: ${combined.join(
        ", "
      )}.`
    );
  } else {
    say(
      "I didn't catch a specific symptom there, but that's fine — I'll ask some direct questions."
    );
  }

  // ----------------------------------------------------------
  // RED FLAGS IMMEDIATELY
  // ----------------------------------------------------------

  const redFlag =
    checkRedFlags(
      rawText,
      state.confirmed
    );

  return {
    state,
    rawText,
    redFlag,
  };
}

// ============================================================
// FOLLOW-UP
// ============================================================

async function askFollowUps(
  state: EngineState,
  rawText: string,
  diseases: DiseaseRecord[],
  frequency: Map<string, number>,
  aliases: Map<string, string>,
  canonicalSymptoms: Set<string>
): Promise<RedFlagResult> {
  let questions = 0;

  while (
    questions <
    MAX_QUESTIONS
  ) {
    const matches =
      rankDiseases(
        diseases,
        state,
        frequency
      );

    const next =
      pickNextSymptom(
        matches,
        state,
        frequency,
        diseases.length
      );

    if (!next) {
      break;
    }

    const answer =
      (
        await askUser(
          `\nDo you also have ${next}? (y/n)\n> `
        )
      )
        .trim()
        .toLowerCase();

    state.asked.add(
      next
    );

    questions++;

    if (
      answer === "y" ||
      answer === "yes"
    ) {
      state.confirmed.add(
        next
      );

      say(
        pick(GOOD)
      );
    } else if (
      answer === "n" ||
      answer === "no"
    ) {
      state.denied.add(
        next
      );

      say(
        pick(BAD)
      );
    } else {
      // Allow natural-language answers.
      const extras =
        extractLocalSymptoms(
          answer,
          aliases,
          canonicalSymptoms
        );

      for (
        const symptom
        of extras
      ) {
        state.confirmed.add(
          symptom
        );
      }

      say(
        "I'll take note of what you described and continue."
      );
    }

    const redFlag =
      checkRedFlags(
        `${rawText} ${answer}`,
        state.confirmed
      );

    if (
      redFlag.urgent
    ) {
      return redFlag;
    }
  }

  return {
    urgent: false,
    message: "",
  };
}

// ============================================================
// PRESENT RESULT
// ============================================================

function presentResult(
  match: DiseaseMatch
): void {
  const disease =
    match.disease;

  say(
    `Strongest database match: **${disease.name}**`
  );

  say(
    `Matched symptoms: ${match.matchedSymptoms.join(
      ", "
    )}`
  );

  if (
    disease.emergency === "Yes"
  ) {
    say(
      "This entry is classified as an emergency in your database."
    );
  } else if (
    disease.emergency === "Depends"
  ) {
    say(
      "The urgency for this entry depends on the clinical situation."
    );
  } else {
    say(
      "This entry is not classified as an emergency in your database."
    );
  }

  say(
    `Recommended department: ${disease.department}.`
  );

  if (
    disease.note
  ) {
    say(
      `Database note: ${disease.note}.`
    );
  }
}

// ============================================================
// REVEAL
// ============================================================

async function reveal(
  state: EngineState,
  diseases: DiseaseRecord[],
  frequency: Map<string, number>
): Promise<void> {
  const matches =
    rankDiseases(
      diseases,
      state,
      frequency
    );

  if (
    matches.length === 0
  ) {
    say(
      "I couldn't find a sufficiently strong match in the current database."
    );

    say(
      "A real clinician should evaluate the symptoms, especially if they persist, worsen, or are accompanied by new symptoms."
    );

    return;
  }

  const top =
    matches.slice(0, 3);

  say(
    "Based on the symptoms entered, these are the closest database matches:"
  );

  top.forEach(
    (match, index) => {
      say(
        `${index + 1}. ${match.disease.name} — score ${match.score.toFixed(
          2
        )}`
      );
    }
  );

  say("");

  presentResult(
    top[0]
  );

  say(
    "\n(This is a symptom-matching and triage tool, not a medical diagnosis. A clinician should confirm the result.)"
  );
}

// ============================================================
// MAIN
// ============================================================

async function runConversation(): Promise<void> {
  try {
    say(
      `${pick(
        GREETINGS
      )} ${pick(ASK)}`
    );

    const {
      state,
      rawText,
      redFlag: initialRedFlag,
    } =
      await gatherSymptoms(
        aliasIndex,
        allSymptoms
      );

    // --------------------------------------------------------
    // STOP BEFORE DISEASE MATCHING IF RED FLAG
    // --------------------------------------------------------

    if (
      initialRedFlag.urgent
    ) {
      say(
        `\n⚠️ ${initialRedFlag.message}`
      );

      say(
        "\nI am not going to guess a diagnosis from an urgent symptom combination."
      );
    } else {
      const followUpRedFlag =
        await askFollowUps(
          state,
          rawText,
          allDiseases,
          symptomFrequency,
          aliasIndex,
          allSymptoms
        );

      if (
        followUpRedFlag.urgent
      ) {
        say(
          `\n⚠️ ${followUpRedFlag.message}`
        );

        say(
          "\nI am not going to guess a diagnosis from an urgent symptom combination."
        );
      } else {
        await reveal(
          state,
          allDiseases,
          symptomFrequency
        );
      }
    }

    say(
      "\n(This is a simplified self-check tool, not a medical diagnosis.)"
    );

    say(
      pick(GOODBYE)
    );

    const restart =
      (
        await askUser(
          "\nAnything else you'd like to check? (y/n)\n> "
        )
      )
        .trim()
        .toLowerCase();

    if (
      restart === "y" ||
      restart === "yes"
    ) {
      await runConversation();
    } else {
      rl.close();
    }
  } catch (error) {
    console.error(
      "\n[MediHub Error]",
      error
    );

    rl.close();
  }
}

// ============================================================
// STARTUP
// ============================================================

const allDiseases =
  loadDiseases(
    DB_PATH
  );

const allSymptoms =
  getAllCanonicalSymptoms(
    allDiseases
  );

const dictionary =
  loadSymptomDictionary(
    DICT_PATH
  );

const aliasIndex =
  buildAliasIndex(
    dictionary,
    allSymptoms
  );

const symptomFrequency =
  calculateFrequency(
    allDiseases
  );

console.log(
  `[MediHub] Loaded ${allDiseases.length} diseases and ${allSymptoms.size} canonical symptoms.`
);

console.log(
  `[MediHub] Loaded ${dictionary.size} symptom-language mappings.`
);

runConversation();