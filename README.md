# CarePath / MediHub Prototype

CarePath/Medihub is a modern healthcare patient navigation and portal web application designed to streamline appointment booking, medical history management, and patient-provider interaction.

WARNING: Disclaimer: This application is an educational prototype built for portfolio and demonstration purposes. Diagnosis and department routing outputs are generated via synthetic database logic and AI APIs. It is not a substitute for professional medical advice, diagnosis, or emergency care.

--------------------------------------------------------------------

## Features

- Dual-Engine Triage & Diagnosis:
  * Symptom-Disease Matching: Custom rule-based database matching symptoms to conditions with AI API assistance.
  * Direct AI Assessment: Natural language symptom evaluation using AI models to determine severity and recommend the correct medical department (e.g., Cardiology, Neurology, Gastroenterology).

- Greater Tunis Medical Facilities Locator & Interactive Map:
  * Searchable database of public and private hospitals, clinics, and specialized centers across Greater Tunis.
  * Integrated interactive map displaying facility locations, departments, and contact details.

- Patient Progress & Recovery Tracker:
  * Follow-up log to track symptom changes, recovery milestones, and post-consultation progress.

--------------------------------------------------------------------

## Quick Start & Setup Guide

Because sensitive credentials and generated runtime environments are excluded from this repository for security, follow these setup steps to run the application locally.

1. PREREQUISITES
----------------
Ensure you have the following installed on your machine:
- Node.js (v18.0.0 or higher) & npm
- Python (v3.9 or higher)
- Git


2. CLONE THE REPOSITORY
-----------------------
Open your terminal / command prompt and run:

  git clone https://github.com/Aziz-chaouachi/Carepath-Medihub-prototype.git
  cd Carepath-Medihub-prototype


3. INSTALL NODE.JS DEPENDENCIES
--------------------------------
Install dependencies for both the root project and the triage engine:

  npm install
  cd triage-engine
  npm install
  cd ..


4. CONFIGURE API KEYS & ENVIRONMENT VARIABLES
----------------------------------------------
The backend triage service requires valid API keys to communicate with AI providers (preferably OpenRouter's try this link: https://openrouter.ai/openrouter/free ).

Step A: Navigate into the triage-engine directory:
  cd triage-engine

Step B: Create a file named .env inside triage-engine using your terminal:
  - Windows CMD:
      type NUL > .env
  - macOS / Linux / Git Bash:
      touch .env

Step C: Open the newly created .env file in a text editor and add your API key:
  OPENROUTER_API_KEY=your_openrouter_api_key_here

Step D: Return to the root folder:
  cd ..


5. SET UP PYTHON ENVIRONMENT
----------------------------
Certain database processing scripts (inject.py, dictionary.py) require a Python virtual environment:

Step A: Create a virtual environment:
  python -m venv .venv

Step B: Activate the virtual environment according to your OS:
  - Windows CMD:
      .venv\Scripts\activate
  - macOS / Linux / Git Bash:
      source .venv/bin/activate

Step C: Install required packages:
  pip install pandas openpyxl


6. RUN THE APPLICATION
----------------------
Step A: Start the Triage Backend Engine:
  cd triage-engine
  npx tsx api-server.ts

Step B: Launch the Web Interface:
  Open MediHub.html or medihub-chat-interface.html directly in your web browser (or serve them using a local static server like VS Code Live Server).

--------------------------------------------------------------------

## License & Commercial Rights

This project is dual-licensed:

1. Non-Commercial / Public Use:
   Licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0). You are free to share and adapt the material for non-commercial and educational purposes, provided credit is given.

2. Commercial Licensing:
   Unauthorized commercial exploitation or monetization by third parties is strictly prohibited. If you or your organization wish to use, host, or integrate CarePath / MediHub for commercial purposes, please contact the author directly to acquire a commercial usage license.
