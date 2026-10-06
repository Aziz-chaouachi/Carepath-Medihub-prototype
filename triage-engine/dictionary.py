import csv
import json
import os
import ssl
import time
import urllib.parse
import urllib.request

import certifi
from sentence_transformers import SentenceTransformer, util
from wordfreq import zipf_frequency


# ============================================================
# CONFIGURATION
# ============================================================

CSV_FILE = "Comprehensive_Medical_Diseases_Database.csv"

OUTPUT_FILE = "everyday_symptom_dictionary.json"

# Save progress every N symptoms
SAVE_EVERY = 25

# Pause between Datamuse requests
DELAY = 0.15

# Maximum Datamuse candidates
MAX_CANDIDATES = 30

# Semantic similarity threshold
# Higher = stricter
SIMILARITY_THRESHOLD = 0.45

# Minimum everyday English frequency
# Higher = more common words
WORD_FREQUENCY_THRESHOLD = 3.0


# ============================================================
# SSL
# ============================================================

SSL_CONTEXT = ssl.create_default_context(
    cafile=certifi.where()
)


# ============================================================
# LOAD AI MODEL
# ============================================================

print()
print("Loading semantic model...")
print()

model = SentenceTransformer("all-MiniLM-L6-v2")

print()
print("Semantic model loaded.")
print()


# ============================================================
# LOAD CSV
# ============================================================

def load_symptoms():

    symptoms = set()

    print("Reading CSV...")

    with open(
        CSV_FILE,
        "r",
        encoding="utf-8-sig",
        newline=""
    ) as file:

        reader = csv.DictReader(file)

        if not reader.fieldnames:
            raise ValueError("CSV has no headers.")

        # Find Symptoms column
        column = None

        for name in reader.fieldnames:

            if name.lower() == "symptoms":
                column = name
                break

        if column is None:
            raise ValueError(
                "Could not find a Symptoms column."
            )

        for row in reader:

            value = row.get(column)

            if not value:
                continue

            # Your CSV separates symptoms with commas
            terms = value.split(",")

            for term in terms:

                term = term.strip().lower()

                if term:
                    symptoms.add(term)

    return sorted(symptoms)


# ============================================================
# DATAMUSE
# ============================================================

def datamuse_request(url):

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MediHub/1.0"
        }
    )

    with urllib.request.urlopen(
        request,
        context=SSL_CONTEXT,
        timeout=15
    ) as response:

        return json.loads(
            response.read().decode("utf-8")
        )


def get_datamuse_candidates(term):

    candidates = []

    encoded = urllib.parse.quote(term)

    # --------------------------------------------------------
    # rel_syn = actual synonyms
    # --------------------------------------------------------

    urls = [

        f"https://api.datamuse.com/words"
        f"?rel_syn={encoded}"
        f"&max={MAX_CANDIDATES}",

        # Words related in meaning
        f"https://api.datamuse.com/words"
        f"?ml={encoded}"
        f"&max={MAX_CANDIDATES}"
    ]

    for url in urls:

        try:

            data = datamuse_request(url)

            for item in data:

                word = item.get("word")

                if not word:
                    continue

                word = word.strip().lower()

                if word == term:
                    continue

                if word not in candidates:
                    candidates.append(word)

        except Exception as error:

            print(
                f"    Datamuse error: {error}"
            )

    return candidates


# ============================================================
# EVERYDAY ENGLISH FILTER
# ============================================================

def is_common_english(word):

    # Calculate frequency in normal English
    frequency = zipf_frequency(
        word,
        "en"
    )

    return frequency >= WORD_FREQUENCY_THRESHOLD


# ============================================================
# BASIC CLEANING
# ============================================================

def clean_candidate(word):

    word = word.strip().lower()

    # Remove weird punctuation
    word = word.strip(".,!?;:\"'()[]{}")

    if not word:
        return None

    # Don't allow extremely long nonsense
    if len(word) > 80:
        return None

    return word


# ============================================================
# SEMANTIC FILTER
# ============================================================

def semantic_filter(
    original,
    candidates
):

    if not candidates:
        return []

    # --------------------------------------------------------
    # Encode original symptom
    # --------------------------------------------------------

    original_embedding = model.encode(
        original,
        convert_to_tensor=True
    )

    # --------------------------------------------------------
    # Encode candidates
    # --------------------------------------------------------

    candidate_embeddings = model.encode(
        candidates,
        convert_to_tensor=True
    )

    # --------------------------------------------------------
    # Calculate similarity
    # --------------------------------------------------------

    scores = util.cos_sim(
        original_embedding,
        candidate_embeddings
    )[0]

    results = []

    for candidate, score in zip(
        candidates,
        scores
    ):

        score = float(score)

        if score >= SIMILARITY_THRESHOLD:

            results.append(
                (
                    candidate,
                    score
                )
            )

    # Highest semantic similarity first
    results.sort(
        key=lambda x: x[1],
        reverse=True
    )

    return results


# ============================================================
# BUILD DICTIONARY
# ============================================================

def load_existing():

    if not os.path.exists(OUTPUT_FILE):
        return {}

    try:

        with open(
            OUTPUT_FILE,
            "r",
            encoding="utf-8"
        ) as file:

            return json.load(file)

    except Exception:

        return {}


def save_dictionary(dictionary):

    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            dictionary,
            file,
            indent=4,
            ensure_ascii=False
        )


# ============================================================
# MAIN
# ============================================================

print("Reading symptoms...")

symptoms = load_symptoms()[:20]

print(
    f"Found {len(symptoms)} unique terms."
)

print()

dictionary = load_existing()

if dictionary:

    print(
        f"Loaded {len(dictionary)} previously processed terms."
    )

print()

for index, term in enumerate(
    symptoms,
    start=1
):

    # --------------------------------------------------------
    # Resume support
    # --------------------------------------------------------

    if term in dictionary:

        print(
            f"[{index}/{len(symptoms)}] "
            f"{term} -> already processed"
        )

        continue

    print(
        f"[{index}/{len(symptoms)}] {term}"
    )

    # --------------------------------------------------------
    # Get candidates
    # --------------------------------------------------------

    candidates = get_datamuse_candidates(term)

    print(
        f"    Candidates: {len(candidates)}"
    )

    # --------------------------------------------------------
    # Clean
    # --------------------------------------------------------

    cleaned = []

    for candidate in candidates:

        candidate = clean_candidate(candidate)

        if not candidate:
            continue

        if candidate == term:
            continue

        if candidate not in cleaned:
            cleaned.append(candidate)

    # --------------------------------------------------------
    # Common English filter
    # --------------------------------------------------------

    common_candidates = []

    for candidate in cleaned:

        # Check individual words
        words = candidate.split()

        frequencies = [
            zipf_frequency(
                word,
                "en"
            )
            for word in words
        ]

        # Average frequency
        average_frequency = (
            sum(frequencies)
            / len(frequencies)
        )

        if (
            average_frequency
            >= WORD_FREQUENCY_THRESHOLD
        ):

            common_candidates.append(
                candidate
            )

    # --------------------------------------------------------
    # Semantic filtering
    # --------------------------------------------------------

    semantic_results = semantic_filter(
        term,
        common_candidates
    )

    # --------------------------------------------------------
    # Keep best candidates
    # --------------------------------------------------------

    everyday = []

    for candidate, score in semantic_results:

        everyday.append(
            {
                "term": candidate,
                "score": round(score, 3)
            }
        )

    # Keep maximum 8
    everyday = everyday[:8]

    dictionary[term] = everyday

    # --------------------------------------------------------
    # Display
    # --------------------------------------------------------

    if everyday:

        print(
            "    Everyday:"
        )

        for item in everyday:

            print(
                f"       {item['term']} "
                f"({item['score']})"
            )

    else:

        print(
            "    Everyday: []"
        )

    # --------------------------------------------------------
    # Save progress
    # --------------------------------------------------------

    if index % SAVE_EVERY == 0:

        save_dictionary(dictionary)

        print(
            f"    Progress saved "
            f"({len(dictionary)} terms)"
        )

    time.sleep(DELAY)


# ============================================================
# FINAL SAVE
# ============================================================

save_dictionary(dictionary)

print()
print("========================================")
print("DONE")
print("========================================")
print(
    f"Processed: {len(dictionary)} terms"
)
print(
    f"Saved to: {OUTPUT_FILE}"
)