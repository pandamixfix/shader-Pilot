# Shader Pilot: AI-Powered Fractal Flight Simulator 🚀

An experimental flight simulator where a 3D fractal world is generated entirely via **GLSL Raymarching** and can be modified in real-time using **Google Gemini AI**.

## 🧠 AI-Driven Orchestration
This is the core highlight: The app uses **Gemini 1.5 Pro/Flash** not just as a chatbot, but as an **Autonomous Engine** that:
- **Analyzes & Fixes GLSL Code:** Identifies performance bottlenecks or syntax errors and corrects them.
- **Smart UI Generation:** Dynamically creates React UI sliders by analyzing the shader's mathematical literals.
- **Natural Language Control:** Translates user requests (e.g., "make it look like a red nebula") into code modifications or parameter adjustments.
- **Dynamic Soundtrack Patching:** Reconfigures the audio engine's modulation matrix based on user prompts.

## 🎨 Graphics & Physics Engine
- **Fractal Raymarching:** Real-time rendering of KIFS (Koch Integrated Function Systems) fractals using custom Fragment Shaders.
- **3D Physics in Shader Space:** Implemented a CPU-side collision detection system that mirrors the GPU's distance functions.
- **Advanced Post-Processing:** Cinematic Bloom, Chromatic Aberration, and Vignette effects.

## 🎵 Dynamic Audio (Vangelis-inspired)
- A procedural sound engine built with **Web Audio API**.
- Flight parameters (speed, altitude, pitch) are mapped to a synthesis matrix (Drone, Arp, Rhythm) for a truly immersive experience.

## 🛠 Tech Stack
- **Frontend:** React 19, TypeScript, Vite.
- **Graphics:** WebGL 2, GLSL (Custom Raymarching Engine).
- **AI:** Google Generative AI (Gemini SDK).
- **Audio:** Web Audio API (Generative Synthesis).
- **Infrastructure:** Docker, PWA Support.

## 🚀 Installation & Setup
1. Clone the repo: `git clone https://github.com/pandamixfix/shader-Pilot.git`
2. Install dependencies: `npm install`
3. Set your Gemini API Key in `.env.local`
4. Run: `npm run dev`
