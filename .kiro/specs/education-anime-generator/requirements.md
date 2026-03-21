# Requirements Document

## Introduction

The Education Anime Generator is a full-stack application that transforms educational topics into engaging anime-style content, interactive simulations, and 3D models of real-world objects. It is built entirely on open-source models and infrastructure so it can be embedded into or integrated with an existing product via APIs. The system targets students, educators, and e-learning platforms that want to increase engagement through visual, animated, and interactive learning experiences.

---

## Glossary

- **System**: The Education Anime Generator application as a whole.
- **Generator**: The AI pipeline responsible for producing anime-style images, scenes, and animations.
- **Simulation_Engine**: The component that creates interactive, topic-driven educational simulations.
- **Model_3D_Engine**: The component that generates or retrieves 3D models of real-world objects.
- **Topic**: A user-supplied educational subject (e.g., "photosynthesis", "Newton's laws", "World War II").
- **Scene**: A single anime-style visual frame or short animation clip tied to an educational concept.
- **Character**: An anime-style avatar used to narrate or demonstrate educational content.
- **Simulation**: An interactive, browser-rendered environment that lets users explore a concept dynamically.
- **Asset**: Any generated output — image, animation, 3D model, or simulation bundle.
- **User**: A person interacting with the system through the UI or API.
- **API_Client**: An external product or service consuming the system's REST/GraphQL API.
- **Job**: A background processing task that produces one or more Assets.
- **Prompt**: A structured text input sent to an AI model to guide generation.
- **Open_Source_Model**: Any AI model with an open-source license (e.g., Stable Diffusion, TripoSR, Manim).

---

## Requirements

### Requirement 1: Topic-Driven Anime Content Generation

**User Story:** As a student or educator, I want to enter an educational topic and receive anime-style visual content (characters, scenes, short animations) that explain the concept, so that learning becomes more engaging and memorable.

#### Acceptance Criteria

1. WHEN a User submits a Topic, THE System SHALL generate at least one anime-style Scene illustrating the Topic within 60 seconds.
2. WHEN a User submits a Topic, THE Generator SHALL produce a structured Prompt from the Topic before invoking any image model.
3. WHEN the Generator produces a Scene, THE System SHALL attach a text caption explaining the educational concept depicted.
4. WHEN a User requests a Character for a Topic, THE Generator SHALL produce a named anime-style Character consistent with the subject domain (e.g., a scientist character for physics topics).
5. IF the Generator fails to produce a Scene within 120 seconds, THEN THE System SHALL return a descriptive error message and a Job status of "failed".
6. THE System SHALL support generation of at least 4 Scene styles: classroom, laboratory, outdoor, and fantasy.
7. WHEN a User requests an animation, THE Generator SHALL produce a short looping animation (GIF or WebM, minimum 2 seconds) for the Topic.
8. WHERE a User has selected a preferred art style, THE Generator SHALL apply that style consistently across all Scenes in the same session.

---

### Requirement 2: Interactive Simulation Generation

**User Story:** As an educator, I want the system to generate an interactive simulation for a given Topic, so that students can explore concepts hands-on rather than passively viewing content.

#### Acceptance Criteria

1. WHEN a User submits a Topic, THE Simulation_Engine SHALL generate a runnable, browser-based interactive simulation within 90 seconds.
2. WHEN a simulation is generated, THE Simulation_Engine SHALL include at least one interactive control (slider, button, or drag element) that changes a visible parameter of the simulation.
3. WHEN a User interacts with a simulation control, THE Simulation_Engine SHALL update the simulation state and re-render within 100 milliseconds.
4. THE Simulation_Engine SHALL support at least the following Topic categories: physics, chemistry, biology, mathematics, and history.
5. IF a Topic does not map to a known simulation template, THEN THE Simulation_Engine SHALL generate a fallback text-and-diagram simulation rather than returning an error.
6. WHEN a simulation is complete, THE System SHALL provide a shareable URL for the simulation Asset.
7. THE Simulation_Engine SHALL render simulations using only open-source browser libraries (e.g., Three.js, D3.js, Matter.js).
8. WHEN a simulation is exported, THE System SHALL package it as a self-contained HTML bundle that runs without an internet connection.

---

### Requirement 3: 3D Model Generation of Real-World Objects

**User Story:** As a student, I want to see a 3D model of a real-world object related to my topic (e.g., a human heart, a molecule, a historical artifact), so that I can understand its structure from all angles.

#### Acceptance Criteria

1. WHEN a User requests a 3D model for a named real-world object, THE Model_3D_Engine SHALL generate or retrieve a 3D model in GLTF or OBJ format within 120 seconds.
2. WHEN a 3D model is delivered, THE System SHALL render it in an interactive 3D viewer in the browser with orbit, zoom, and pan controls.
3. THE Model_3D_Engine SHALL use only Open_Source_Models for generation (e.g., TripoSR, Shap-E, or equivalent).
4. WHEN a 3D model is generated, THE System SHALL attach metadata including object name, educational description, and scale reference.
5. IF the Model_3D_Engine cannot generate a model for the requested object, THEN THE System SHALL return a descriptive error and suggest alternative objects.
6. WHEN a User downloads a 3D model, THE System SHALL provide it in GLTF format with all textures embedded.
7. THE Model_3D_Engine SHALL support at least the following object categories: anatomy, chemistry (molecules), astronomy, historical artifacts, and mechanical parts.

---

### Requirement 4: Open-Source Architecture and API Integration

**User Story:** As a product developer, I want the system to expose a well-documented REST API built on open-source components, so that I can integrate it into my existing product without vendor lock-in.

#### Acceptance Criteria

1. THE System SHALL expose all generation capabilities (anime content, simulation, 3D model) through a versioned REST API (e.g., /api/v1/).
2. WHEN an API_Client submits a generation request, THE System SHALL return a Job ID within 500 milliseconds.
3. WHEN a Job is complete, THE System SHALL make the resulting Asset available at a stable URL for at least 24 hours.
4. THE System SHALL provide an OpenAPI 3.0 specification document for all endpoints.
5. WHEN an API_Client polls a Job status endpoint, THE System SHALL return one of: "queued", "processing", "complete", or "failed".
6. THE System SHALL use only open-source AI models and libraries for all generation pipelines.
7. WHERE an API_Client provides an API key, THE System SHALL authenticate the request before processing.
8. THE System SHALL support webhook callbacks so an API_Client can receive Job completion notifications without polling.
9. WHEN an API_Client sends a malformed request, THE System SHALL return an HTTP 400 response with a structured error body describing the validation failure.

---

### Requirement 5: User Interface and Experience

**User Story:** As a student or educator, I want a clean, intuitive web interface where I can enter a topic, choose what to generate, and view results in one place, so that I can use the tool without technical knowledge.

#### Acceptance Criteria

1. THE System SHALL provide a single-page web application as the primary user interface.
2. WHEN a User enters a Topic and selects a generation type, THE System SHALL display a real-time progress indicator until the Job completes.
3. WHEN a Job completes, THE System SHALL display the generated Asset inline without requiring a page reload.
4. THE System SHALL provide a gallery view where a User can browse all previously generated Assets for their session.
5. WHEN a User views a 3D model, THE System SHALL render it in an embedded interactive viewer within the same page.
6. WHEN a User views a simulation, THE System SHALL render it in an embedded iframe or canvas within the same page.
7. THE System SHALL be responsive and usable on screens with a minimum width of 320px.
8. IF a Job fails, THE System SHALL display a human-readable error message and a retry button.
9. WHERE a User has generated multiple Assets, THE System SHALL allow downloading all Assets as a ZIP archive.

---

### Requirement 6: Asset Management and Storage

**User Story:** As a user, I want my generated assets to be stored and retrievable, so that I can revisit and share them later.

#### Acceptance Criteria

1. THE System SHALL store all generated Assets in a persistent object store (e.g., MinIO or equivalent open-source solution).
2. WHEN an Asset is stored, THE System SHALL record metadata including Topic, generation type, timestamp, and file size.
3. WHEN a User requests an Asset by ID, THE System SHALL return the Asset or a 404 error if it does not exist.
4. THE System SHALL support Asset deletion, removing both the file and its metadata record.
5. WHEN an Asset is deleted, THE System SHALL return HTTP 204 and THE Asset SHALL no longer be retrievable.
6. THE System SHALL enforce a configurable maximum storage quota per user session.
7. WHEN a User's storage quota is exceeded, THE System SHALL reject new generation requests with an HTTP 429 response and a descriptive message.

---

### Requirement 7: Background Job Processing

**User Story:** As a developer integrating the system, I want generation tasks to run asynchronously in a reliable job queue, so that long-running AI tasks do not block the API or UI.

#### Acceptance Criteria

1. THE System SHALL process all generation requests as asynchronous Jobs using an open-source task queue (e.g., Celery with Redis, or BullMQ).
2. WHEN a Job is submitted, THE System SHALL assign it a unique Job ID and persist its status.
3. WHEN a Job fails due to a transient error, THE System SHALL retry the Job up to 3 times with exponential backoff before marking it as "failed".
4. THE System SHALL support at least 10 concurrent Jobs without degradation of response time for status polling.
5. WHEN a Job has been in "queued" state for more than 5 minutes, THE System SHALL log a warning and escalate its priority.
6. THE System SHALL expose a Job history endpoint returning the last 50 Jobs for a given session or API key.

---

### Requirement 8: Content Safety and Quality

**User Story:** As a platform operator, I want all generated content to be safe for educational use, so that the system can be deployed in school environments.

#### Acceptance Criteria

1. WHEN the Generator produces any Asset, THE System SHALL run it through a content safety classifier before delivering it to the User.
2. IF a generated Asset is classified as unsafe, THEN THE System SHALL discard the Asset, mark the Job as "failed", and return a safety violation message.
3. THE System SHALL log all safety violations with the Topic, timestamp, and classifier output for audit purposes.
4. WHEN a User submits a Topic containing explicit or harmful keywords, THE System SHALL reject the request before generation begins and return an HTTP 422 response.
5. THE System SHALL use an open-source content safety model (e.g., LlamaGuard or equivalent) for classification.

---

### Requirement 9: Educational Storyification and Anime Series Generation

**User Story:** As a student or educator, I want the system to transform an educational topic into a structured anime story — with episodes, a narrative arc, characters, and scenes — so that students can learn through an immersive, story-driven experience similar to watching an educational anime series.

#### Acceptance Criteria

1. WHEN a User submits a Topic for storyification, THE System SHALL generate a Story_Plan containing a title, synopsis, episode list (minimum 3 episodes), and a cast of named Characters within 30 seconds.
2. WHEN a Story_Plan is approved by the User, THE Generator SHALL produce anime-style Scenes for each episode in sequence, with each episode containing at least 3 Scenes.
3. WHEN generating a Story_Plan, THE System SHALL map educational concepts from the Topic to narrative events (e.g., a character "discovering" a scientific law as a plot point).
4. WHEN an episode is generated, THE System SHALL include a narrator caption per Scene that explains the educational concept being depicted.
5. THE System SHALL support generating a full mini-series of up to 10 episodes for a single Topic.
6. WHEN all episodes are generated, THE System SHALL assemble them into a viewable sequential player (episode list + scene viewer) within the UI.
7. WHEN a User plays an episode, THE System SHALL display Scenes in order with captions, simulating an anime viewing experience.
8. THE System SHALL allow a User to export the full series as a ZIP archive containing all Scenes, captions, and a JSON manifest describing the Story_Plan.
9. WHERE a User has an existing Character from a previous session, THE System SHALL allow reusing that Character across new Story_Plans for continuity.
10. IF the Generator cannot produce a Scene for a specific episode, THEN THE System SHALL substitute a placeholder Scene with a text-only explanation and continue generating remaining episodes.
11. THE System SHALL generate a Story_Plan using an open-source LLM (e.g., Mistral, LLaMA, or equivalent) for narrative structuring before invoking image generation.

---

### Requirement 10: Bella — 3D Humanoid AI Learning Assistant

**User Story:** As a student, I want a persistent 3D anime-style humanoid assistant named "Bella" who can talk to me, answer questions about my topic, guide me through the LMS, and appear alongside generated content, so that I have a personal AI companion that makes learning feel interactive and engaging.

#### Acceptance Criteria

1. THE System SHALL render Bella as a 3D anime-style humanoid avatar using the VRM format, displayed in the browser via Three.js and @pixiv/three-vrm.
2. WHEN a User navigates to any page in the LMS, THE System SHALL display Bella in a persistent overlay panel with idle animation.
3. WHEN a User types or speaks a question, THE System SHALL send it to Bella's LLM backend (Mistral 7B) and display Bella's response as both text and synthesized speech.
4. WHEN Bella speaks, THE System SHALL animate Bella's mouth using viseme-based lip sync synchronized to the TTS audio output.
5. THE System SHALL use an open-source TTS engine (e.g., Coqui TTS or Kokoro TTS) for Bella's voice synthesis.
6. WHEN a User generates content (anime scene, simulation, 3D model, or story), THE System SHALL have Bella provide a contextual educational explanation of the generated content.
7. WHEN a User is idle for more than 60 seconds, THE System SHALL have Bella proactively offer a hint or suggest the next learning action.
8. THE System SHALL support at least 3 Bella emotional states: neutral, happy, and thinking — each with a distinct animation.
9. WHERE a User has completed a topic or episode, THE System SHALL have Bella congratulate the User with a celebratory animation and message.
10. THE System SHALL allow the User to minimize or hide Bella without losing session context.
11. THE System SHALL persist Bella's conversation history for the current session so context is maintained across page navigations.
12. IF the TTS engine fails to synthesize speech, THEN THE System SHALL display Bella's response as text only without interrupting the interaction.
