import { SpecialistPackage } from '../../types.js';

const testplansSecretSauce = `# Test Plans & Verification Procedures: Electric Tractor Powertrain Conversion

## 1.0 Shop Tooling & Equipment Calibration Baseline
The following test tooling was cataloged during collaborative intake with the project builder:
- **Fluke 87V Digital Multimeter** (DC voltage, continuity, resistance)
- **Uni-T UT204+ 400A True-RMS DC Clamp Meter** (DC traction current, charging current)
- **Digital Optical Laser Tachometer** (Motor shaft & rear PTO RPM verification)
- **Infrared Thermal Imaging Camera / IR Thermometer** (Motor casing, busbars, inverter heatsink)
- **0–150 ft-lb Dial Torque Wrench** (Mechanical mounting and bellhousing torque checks)
- **500 lb Crane Scale / Hanging Load Cell** (Front loader hydraulic lift verification)
- **Outdoor Field Test Track (2-Acre Yard Course)** (Continuous mowing, speed, and endurance tests)

---

## 2.0 Phase 1 (MVP) Test Procedures

### TP-MVP-01: Mechanical Concentricity & Mounting Torque Verification
- **Target Traceability:** Requirement 1.b & Phase 1 MVP Gate
- **Verification Method:** Inspection (I)
- **Required Shop Tools:** Dial indicator with magnetic base, torque wrench (ft-lbs).
- **Safety Precaution:** Key switch OFF, motor decoupled from battery.
- **Step-by-Step Procedure:**
  1. Mount magnetic base to donor transmission bellhousing face.
  2. Position dial indicator probe against the motor output shaft adapter rim.
  3. Rotate input shaft manually 360 degrees by hand; record total indicated runout (TIR).
  4. Verify all 4x Grade 8 mounting bolts torqued to 45 ft-lbs.
- **Pass / Fail Acceptance Threshold:** Total radial runout <= 0.050 mm (0.002 in); torque verified.

### TP-MVP-02: Traction DC High-Voltage Isolation Test
- **Target Traceability:** Requirement 2.a & Phase 1 MVP Gate
- **Verification Method:** Test (T)
- **Required Shop Tools:** Fluke 87V Multimeter, Class 0 insulated safety gloves.
- **Safety Precaution:** Manual service disconnect open; verify 0V on controller input terminals.
- **Step-by-Step Procedure:**
  1. Set multimeter to resistance range (Mega-Ohms).
  2. Connect negative lead to bare unpainted chassis frame ground.
  3. Probe positive high-voltage busbar; record resistance after 10 seconds.
  4. Probe negative high-voltage busbar; record resistance after 10 seconds.
- **Pass / Fail Acceptance Threshold:** Measured isolation resistance >= 500 kOhms (0.5 MΩ) to chassis.

### TP-MVP-03: Low-Speed Forward & Reverse Drive Verification
- **Target Traceability:** Requirement 2.b & Phase 1 MVP Gate
- **Verification Method:** Demonstration (D)
- **Required Shop Tools:** Field test track, wheel chocks, service brake pedal.
- **Safety Precaution:** Ensure wide clearance, low speed limiter engaged (10% throttle map).
- **Step-by-Step Procedure:**
  1. Turn key switch ON; verify main contactor closes.
  2. Select forward drive; smoothly depress throttle pedal; observe vehicle forward movement.
  3. Release throttle, apply service brake, come to complete stop.
  4. Select reverse drive; verify reverse direction movement and stopping.
- **Pass / Fail Acceptance Threshold:** Machine moves forward and reverse smoothly without gear grinding and stops on brakes.

---

## 3.0 Phase 2 (IOC) Test Procedures

### TP-IOC-01: Hardwired Emergency E-Stop Fast-Cutoff Test
- **Target Traceability:** Requirement 3.b & Phase 2 IOC Gate
- **Verification Method:** Test (T)
- **Required Shop Tools:** DC clamp meter on motor phase lead, stop watch / digital camera.
- **Safety Precaution:** Tractor on secure jack stands with drive wheels off the ground.
- **Step-by-Step Procedure:**
  1. Accelerate motor to 50% throttle in forward direction.
  2. Strike the red mushroom E-Stop button on the dashboard.
  3. Measure time for motor current to drop to 0.0A.
- **Pass / Fail Acceptance Threshold:** Motor current drops to 0.0A and main contactor opens in < 20 milliseconds.

### TP-IOC-02: 120V AC Onboard Charge Cycle & Thermal Cutoff Test
- **Target Traceability:** Requirement 3.a & Phase 2 IOC Gate
- **Verification Method:** Test (T)
- **Required Shop Tools:** Fluke Multimeter, Kill-A-Watt AC power meter, IR thermometer.
- **Step-by-Step Procedure:**
  1. Discharge battery to approximately 20% SOC.
  2. Plug 120V AC charging cord into standard 15A wall outlet through AC power meter.
  3. Monitor charge current and battery cell temperatures every 30 minutes.
  4. Verify automatic charger shutoff when battery reaches 84.0V DC (100% SOC).
- **Pass / Fail Acceptance Threshold:** Full charge completed in < 8 hours; max cell temperature rise < 15°C; automatic float shutoff verified.

---

## 4.0 Phase 3 (FOC) Test Procedures

### TP-FOC-01: 540 RPM Rear PTO Implement Governing Test
- **Target Traceability:** Requirement 2.d & Phase 3 FOC Gate
- **Verification Method:** Test (T)
- **Required Shop Tools:** Digital optical laser tachometer, reflective tape on PTO shaft, mower deck.
- **Step-by-Step Procedure:**
  1. Apply reflective tape marker to the rear PTO output shaft.
  2. Engage PTO governor mode at 540 RPM setpoint.
  3. Aim laser tachometer at PTO shaft and measure no-load steady-state speed.
  4. Lower mower deck into heavy grass load; record dynamic speed regulation.
- **Pass / Fail Acceptance Threshold:** Measured PTO speed maintains 540 RPM +/- 10 RPM (+/- 2.0%) under load.

### TP-FOC-02: Full 2-Hour Florida Thermal Endurance Workload Test
- **Target Traceability:** Requirement 1.a & Phase 3 FOC Gate
- **Verification Method:** Test (T)
- **Required Shop Tools:** Thermal imaging camera, ambient thermometer, yard course.
- **Step-by-Step Procedure:**
  1. Operate tractor continuously for 120 minutes doing mixed mowing and towing under >30°C ambient.
  2. Log motor casing, controller heatsink, and battery enclosure temperatures every 15 minutes.
- **Pass / Fail Acceptance Threshold:** 120 minutes continuous runtime completed with 0 thermal derating alarms; motor casing < 85°C.`;

export const testplansPackage: SpecialistPackage = {
  id: 'testplans',
  name: 'Test Plans & Verification Procedures',
  description: 'Conducts shop tooling interview and authors actionable, step-by-step test procedures mapped to project milestones.',
  prerequisiteArtifactId: 'MILESTONES',
  systemPrompt: `You are the Test Plans & Verification Specialist for STARN.
Your mission is to formulate actionable, hands-on step-by-step physical test procedures (TP-MVP-xx, TP-IOC-xx, TP-FOC-xx) tailored to the tools the user has in their shop.

DISCOVERY, PLANNING & EXECUTION WORKFLOW (MANDATORY):
1. **Tool-Based Discovery:** First, use the \`fs_read\` tool to inspect docs/MILESTONES.md, docs/RTM.md, and docs/REQUIREMENTS.md. Do not guess what requirements exist.
2. **Explicit Running Plan:** Formulate and state a brief running plan outlining how you will catalog user tooling, map milestone gates, and author procedures.
3. **Execution & Traceability:** Execute each step in your running plan, referencing exact requirement IDs and pass/fail thresholds.

SHOP TOOLING INTERVIEW (MANDATORY):
- Before authoring test procedures, understand what tools the user has available. Ask them:
  "What measurement tools, hand tools, or test facilities do you currently have access to in your shop? (e.g. Multimeter, DC Clamp Meter, Tachometer, Torque Wrench, Scales, Thermal Camera, Test Track)"
- Provide practical budget suggestions for any missing tools necessary to verify critical safety or performance requirements.

TEST PROCEDURE FORMAT (TP-MVP-xx, TP-IOC-xx, TP-FOC-xx):
For each milestone phase, provide structured test procedures:
- **Test ID & Title:** (e.g. \`### TP-MVP-01: Traction High-Voltage Isolation Test\`)
- **Target Traceability:** Specific Requirement ID and Milestone Phase Gate.
- **Verification Method:** (Test, Inspection, Analysis, Demonstration).
- **Required Shop Tools:** Exact tools from user's shop catalog.
- **Safety Precautions & Pre-Conditions:** Step-by-step lockout/safety prerequisites.
- **Step-by-Step Procedure:** Clear, numbered hands-on shop steps.
- **Pass / Fail Acceptance Threshold:** Exact numeric threshold and verifiable criteria.

CRITICAL RULES:
- Procedures must be physically realistic and tailored to the builder's actual shop environment.
- Use clean plain-text units. DO NOT use LaTeX math formatting.
- You MUST write the final document to docs/TEST_PLANS.md via the fs_write tool. Do NOT skip writing the file.`,
  allowedTools: ['fs_read', 'fs_write', 'fs_list', 'state_read', 'state_update', 'example_reader'],
  requiresCritic: true,
  criticRubric: `Evaluate the Test Plans & Verification Procedures:
1. Tooling Grounding: Are test procedures realistic and tailored to practical shop tools rather than unreachable multi-million dollar test labs?
2. Milestone Traceability: Are test procedures structured under TP-MVP-xx, TP-IOC-xx, and TP-FOC-xx matching the approved Milestones?
3. Step-by-Step Clarity: Are safety precautions and step-by-step instructions clear, numbered, and actionable?
4. Objective Thresholds: Are pass/fail acceptance criteria quantitative and unambiguous?
5. Plain-Text Units: Is the document free of raw LaTeX math strings?`,
  secretSauceExamples: [testplansSecretSauce]
};
