# CarePath / MediHub Prototype

CarePath/Medihub is a modern healthcare patient navigation and portal web application designed to streamline appointment booking, medical history management, and patient-provider interaction.

⚠️ Disclaimer: This application is an educational prototype built for portfolio and demonstration purposes. Diagnosis and department routing outputs are generated via synthetic database logic and AI APIs. It is not a substitute for professional medical advice, diagnosis, or emergency care.

---

## Dual-Engine Triage & Diagnosis:

 - Symptom-Disease Matching: Custom rule-based database matching symptoms to conditions with AI API assistance.

 - Direct AI Assessment: Natural language symptom evaluation using AI models to determine severity and recommend the correct medical department (e.g., Cardiology, Neurology, Gastroenterology).

Greater Tunis Medical Facilities Locator & Interactive Map:

 - Searchable database of public and private hospitals, clinics, and specialized centers across Greater Tunis.

 - Integrated interactive map displaying facility locations, departments, and contact details.

Patient Progress & Recovery Tracker:

 - Follow-up log to track symptom changes, recovery milestones, and post-consultation progress.


## Quick Start & Setup Guide

Whether you want to explore the prototype locally or build upon it, follow the steps below to get up and running.

1. PREREQUISITES
----------------
- Node.js (v18.0.0 or higher)
- npm (packaged with Node.js) or yarn
- Git

2. CLONE THE REPOSITORY
-----------------------
Open your terminal / command prompt and run:

  git clone https://github.com/Aziz-chaouachi/Carepath-Medihub-prototype.git
  cd Carepath-Medihub-prototype

3. INSTALL DEPENDENCIES
-----------------------
Run the following command in the project root folder:

  npm install

4. CONFIGURE ENVIRONMENT VARIABLES
-----------------------------------
Create your local environment file according to your Operating System:

  - macOS / Linux / Git Bash:
      cp .env.example .env.local

  - Windows Command Prompt (CMD):
      copy .env.example .env.local

  - Windows PowerShell:
      Copy-Item .env.example .env.local

  (Note: If .env.example does not exist, manually create a file named .env.local in the root directory)

5. START THE DEVELOPMENT SERVER
--------------------------------
Run:

  npm run dev

  (Note: If your project uses Create React App instead of Next.js/Vite, run "npm start")

6. ACCESS IN BROWSER
--------------------
Open your web browser and go to:

  http://localhost:3000
  (or http://localhost:5173 if using Vite)

7. AVAILABLE COMMANDS
---------------------
  npm run dev      - Starts the development server with hot reload
  npm run build    - Creates an optimized production build
  npm run lint     - Checks code for formatting & syntax errors
  npm run preview  - Previews the production build locally
====================================================================

