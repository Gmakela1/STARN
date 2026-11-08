# Human-Centered Approachable Hardware UI Redesign Specification

## 1. Executive Summary & Design Vision

### 1.1 The Core Purpose
STARN helps users turn physical hardware ideas—solar sheds, vehicle electrification, outdoor structures, custom robotics, maker and fabrication projects—into real, working machines.

The primary user is often **not a seasoned aerospace systems engineer**. They are an ambitious maker, property owner, inventor, or small-team fabricator who knows what they want to achieve, but faces a daunting technical gap:
- How do the subsystems connect safely?
- What exact parts and wire gauges are required?
- What will it cost and when will parts arrive?
- What are the step-by-step instructions to assemble and verify it without causing fires or breaking parts?

### 1.2 The Design Mandate: "Warm Precision & Progressive Disclosure"
1. **Easy on the Eyes & Approachable**:
   - Avoid intimidating, cold, military-style jargon or overwhelming crypto-cockpit density.
   - Use a sleek, warm-slate aesthetic with soft dark surfaces (`#0b0f17`, `#111827`), generous whitespace, comfortable typography, friendly iconography, and warm teal/cyan accents.
2. **Never Dumb Down Content**:
   - Preserve 100% of the engineering rigor, traceability, critic standards, two-tier BOM calculations, and physical safety constraints.
   - Use **progressive disclosure**: lead with plain-English summaries, visual progress rings, and clear milestones; allow 1-click drill-downs into raw specs, technical schematics, and tabular data.
3. **From Idea to Assembly in 4 Intuitive Lifecycle Hubs**:
   - Replace the disconnected 8-tab flat layout with a natural maker progression:
     1. **Mission Dashboard** ("Where is my project?")
     2. **Project Roadmap** ("What is the step-by-step journey?")
     3. **Engineering Studio** ("Plan and design with the AI")
     4. **Materials & Build Floor** ("Buy parts & assemble in the shop")
     5. **Vault & Settings** ("Manuals, files, 3D twin & configuration")

---

## 2. Information Architecture: The 4 Maker Hubs

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  STARN  //  ELECTRIC TRACTOR TEST  •  Active Stage: [02 Architecture]  •  [● AI Ready]                 │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  [1. Dashboard]     [2. Roadmap]     [3. Studio]     [4. Materials & Build]     [5. Vault & Settings]  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Hub 1: Mission Dashboard ("Where are we?")
- **Plain-English Project Charter**: Background, Purpose, Goals, and Scope presented in readable cards with human-friendly headings.
- **Top Maker Metrics**:
  - *Design Progress*: Circular/bar progress meter of the 13 roadmap stages.
  - *Materials & Budget*: Estimated vs. actual spend, parts received vs. total parts.
  - *Active Alerts*: Count of unresolved builder questions or flagged defects.
- **1-Click Executive PDF Briefing Export**: Direct download for partners, lenders, or shop binders.

### Hub 2: Project Roadmap ("The Journey from Idea to Build")
- Interactive serpentine trajectory showing the 13 project phases.
- Plain-English subtitles for every phase:
  - `01 CONOPS` → *User Intent & Project Charter*
  - `02 Architecture` → *Subsystem Layout & Flow*
  - `03 ICD` → *Wiring, Pinouts & Physical Connections*
  - `04 Capabilities` → *What the Machine Must Do*
  - `05 Requirements` → *Engineering Performance Criteria*
  - `06 BOM` → *Shopping List & Hardware Specs*
  - `07 RTM` → *Traceability & Verification Matrix*
  - `08 Milestones` → *Phase Gates (MVP, IOC, FOC)*
  - `09 Risk Register` → *Safety Hazards & Mitigations*
  - `10 Build Sequence` → *High-Level Assembly Order*
  - `11 Work Instructions` → *Step-by-Step Hands-On Shop Guides*
  - `12 Test Plans` → *Shop Verification Procedures*
  - `13 SOW` → *Statement of Work & Contractor Scope*
- Clicking any phase navigates directly into the **Engineering Studio** with that document loaded.

### Hub 3: Engineering Studio ("Plan & Design with the AI")
- **Friendly Specialist Header**:
  - Shows which specialist is currently helping: e.g. `⚡ Electrical & Powertrain Guide`, `📐 Systems Architect`, `🔩 Sourcing & Materials Specialist`.
  - Plain-English document selector dropdown with completion status badges.
- **Left Column: Collaborative AI Workspace**:
  - Clear, human conversational stream.
  - **Live Action Cards**: Instead of cryptic debug logs, visually scannable cards show what the AI is doing:
    - `🔍 Looking up specs for 72V 10kW motor...`
    - `📄 Inspecting wiring diagram in reference/manual.pdf...`
    - `✏️ Updating shopping list with 2x 400A contactors...`
  - Starter prompt chips for common next steps:
    - "What tools do I need for this step?"
    - "Check electrical safety & fusing"
    - "Review draft with Critic"
- **Right Column: Live Document & Changes**:
  - Toggle between **"Clean Document"** (easy-reading markdown) and **"Review Changes"** (side-by-side diff of what the AI changed).
  - Clear Critic Card summarizing quality in plain terms (e.g. "Ready for build", "Needs safer fusing threshold").
  - Prominent **Approve & Unlock Next Phase** button.
- **Anchored Checkpoint Drawer**:
  - When the AI completes a major deliverable draft, a non-intrusive bottom drawer slides up with a plain-language summary and 3 clear buttons:
    - `Accept & Save` (Green)
    - `Ask for Changes` (Amber)
    - `Discard Draft` (Slate)

### Hub 4: Materials & Build Floor ("Make it happen in the shop")
Sub-segmented into 3 dedicated views:
1. **Materials & Shopping List (BOM & Sourcing)**:
   - Filter chips: `All Items`, `Need to Buy`, `Ordered`, `Received in Shop`, `Installed`.
   - Clear columns: Part Name, Subsystem, Qty, Estimated Cost, Actual Cost, Supplier Link, Tracking Number.
   - Clickable carrier badges (UPS, FedEx, USPS, McMaster, Amazon).
2. **Shop Floor Work Instructions**:
   - **Shop Mode Toggle**: High-contrast, large touch targets (56px+ height) designed for greasy fingers or tablet use near the workbench.
   - Big tactile checkboxes for completed steps.
   - Safety warnings highlighted in bold amber/red callout boxes.
   - Photo dropzone to snap or drag inspection pictures directly into the step log.
3. **Discrepancies & Builder Questions**:
   - Replaces the generic "issues" list with a practical workshop troubleshooting tracker.
   - Direct button to route any problem to the AI Studio for an immediate engineering fix.

### Hub 5: Vault & Settings
- **Reference Documents & Manuals**: ICDs, datasheets, user manuals.
- **Quality Examples**: User-provided templates.
- **3D Digital Twin**: Interactive 3D spatial model viewport with subsystem readiness indicators.
- **AI Models & Sourcing Providers**: Configurable keys and local/cloud providers.

---

## 3. Visual Styling & Design System ("Warm Precision")

### 3.1 Color Palette
- **Canvas Background**: `#0b0f17` (deep dark slate, softer than pure black `#000000`).
- **Card Surfaces**: `#111827` (slate-900) with soft border `rgba(148, 163, 184, 0.12)`.
- **Primary Brand / Accent**: `#06b6d4` (warm cyan) and `#0ea5e9` (sky blue).
- **Success / Verified**: `#10b981` (emerald green).
- **Attention / Gate / Warning**: `#f59e0b` (amber).
- **Defect / Action Required**: `#ef4444` (rose/crimson).
- **Muted Text**: `#94a3b8` (slate-400, strictly ≥ 4.8:1 contrast ratio against card backgrounds for WCAG AA).

### 3.2 Typography & Spacing
- **Base Body**: 14px / 16px with line-height 1.6 for comfortable reading of long engineering docs.
- **Monospace Metadata**: `font-mono tabular-nums` for dollar amounts, part numbers, and phase gates.
- **Touch Targets**: Minimum 44×44px for desktop, 56×56px in Shop Floor mode.
- **Focus Rings**: `focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`.

---

## 4. Accessibility & Mobile Responsiveness
- Full WCAG 2.1 AA compliance across all views.
- Contrast ratio ≥ 4.5:1 on all text; 3:1 on large text and graphical controls.
- Responsive mobile drawer navigation under 1024px viewport width.
- Keyboard navigation: `Tab`, `Enter`, `Escape` for modals, popovers, and drawers.
