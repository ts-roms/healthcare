import { WELCOME_TOUR_ID, type TourDef, under } from "./tour";

/**
 * The content of the guided tours. A step names its target with a CSS selector or one of the text forms of `queryTarget`
 * (`card:`, `section:`, `button:`); a target that is not on screen (no facility chosen, a panel the user may not see, a narrow
 * screen) is simply shown as a centred card, so a tour never breaks a page. Wording describes what the screen does, never a
 * clinical rule.
 */
const exact = (path: string) => (pathname: string) => pathname === path;
const patientRecord = (pathname: string) => /^\/patients\/(?!new$|scan$)[^/]+$/.test(pathname);
const triage = (pathname: string) => /^\/queue\/visits\/[^/]+\/triage$/.test(pathname);
const encounter = (pathname: string) => /^\/clinic\/encounters\/[^/]+$/.test(pathname);
const invoice = (pathname: string) => /^\/billing\/invoices\/[^/]+$/.test(pathname);
const billingPatient = (pathname: string) => /^\/billing\/patients\/[^/]+$/.test(pathname);

export const TOURS: TourDef[] = [
  {
    id: WELCOME_TOUR_ID,
    title: "Getting around",
    description: "The menu, search, facility, notifications, help and your account.",
    version: 1,
    steps: [
      {
        title: "Welcome",
        body: "This short tour shows where things are. It takes about a minute and you can skip it at any time. Each main screen also has its own tour the first time you open it; start any of them again from My account, or from your account menu.",
      },
      {
        title: "Your menu",
        body: "Everything you are allowed to use is listed here, grouped by area: patients, clinic, laboratory, billing and more. A number beside an item is work waiting for you.",
        target: 'nav[aria-label="Main"]',
      },
      {
        title: "Find a patient",
        body: "Search by name, patient number or mobile number. Press / anywhere to jump to this box.",
        target: '[role="search"]',
      },
      {
        title: "Your facility",
        body: "Choose the clinic or laboratory you are working in. Queues, schedules and figures follow this choice.",
        target: '[aria-label="Facility"]',
      },
      {
        title: "Notifications",
        body: "Messages for you appear here, such as critical results and requests that need an answer.",
        target: 'a[href="/notifications"]',
      },
      {
        title: "Help is always close",
        body: "The help button opens the user manual, with the chapter about the screen you are on shown first.",
        target: '[aria-label="Open the user manual"]',
      },
      {
        title: "Your account",
        body: "Change your password, set up two-step verification, find Settings, start a tour of the screen you are on, or log out from here.",
        target: '[aria-label="Account menu"]',
      },
    ],
  },
  {
    id: "care-journey",
    title: "A patient's visit, start to finish",
    description: "Check-in, triage, consultation, orders, billing and completing the visit — with a link to each screen.",
    version: 1,
    steps: [
      {
        title: "One patient, one connected visit",
        body: "A visit moves through the same screens in the same order. This tour walks through them; each step links to the screen, and that screen has its own tour the first time you open it.",
      },
      {
        title: "1 · Register or book",
        body: "A new patient is registered once (the system checks for duplicates). A returning patient is found by search. Appointments are booked from open slots of the doctor's schedule.",
        link: { href: "/patients", label: "Open Patients" },
      },
      {
        title: "2 · Check in",
        body: "On the day, check in a booked appointment from the day schedule, or check in a walk-in from the patient's record. Either way the patient gets a queue ticket and waits for triage.",
        link: { href: "/appointments", label: "Open Appointments" },
      },
      {
        title: "3 · Queue and triage",
        body: "The queue board shows who is waiting and in what order. A nurse takes the vital signs, the complaint and the priority at triage; the patient then waits for the consultation.",
        link: { href: "/queue", label: "Open the Queue" },
      },
      {
        title: "4 · Consultation",
        body: "The doctor calls the patient and opens the consultation: notes, diagnoses, prescriptions and laboratory orders are all written in one workspace, beside the patient's allergies and history.",
        link: { href: "/clinic/encounters", label: "Open Consultations" },
      },
      {
        title: "5 · Laboratory and pharmacy",
        body: "Laboratory orders reach the laboratory's worklist, from specimen collection to a released result. Prescriptions are dispensed from stock at the pharmacy.",
        link: { href: "/laboratory/worklist", label: "Open the Laboratory" },
      },
      {
        title: "6 · Billing",
        body: "Services done during the visit appear as charges for the cashier, who prepares an invoice, applies any discount or coverage, issues it and records the payment and receipt.",
        link: { href: "/billing", label: "Open Billing" },
      },
      {
        title: "7 · Completing the visit",
        body: "The doctor signs the consultation to complete it (later changes are amendments, never overwrites). A follow-up can be booked from the same screen, and results and bills are available to the patient in MyHealth where the clinic has turned it on.",
      },
    ],
  },
  {
    id: "patients-search",
    title: "Patients",
    description: "Finding and registering patients.",
    version: 1,
    matches: exact("/patients"),
    permissions: ["patient.search"],
    steps: [
      {
        title: "Find a patient",
        body: "Search by name, patient number or phone. More filters narrow by birth date or an identifier, and can include inactive records.",
        target: 'form[role="search"]',
      },
      {
        title: "Open the record",
        body: "Each result opens the patient's record or their one-screen Patient 360 view. Look the patient up before registering — a duplicate record splits the history.",
        target: "main table",
      },
      {
        title: "New patient",
        body: "Register a patient who is not in the system yet; you are shown possible duplicates before saving.",
        target: 'a[href="/patients/new"]',
      },
      {
        title: "Scan a card",
        body: "If your clinic uses patient QR codes, scan one to open the record or check the patient in.",
        target: 'a[href="/patients/scan"]',
      },
    ],
  },
  {
    id: "patients-new",
    title: "Registering a patient",
    description: "Identity, contact details and duplicate review.",
    version: 1,
    matches: exact("/patients/new"),
    permissions: ["patient.search"],
    steps: [
      {
        title: "Identity",
        body: "Name, sex and date of birth identify the patient and drive the duplicate check, so enter them as they appear on the patient's ID.",
        target: "card:Identity",
      },
      {
        title: "Contact and identifiers",
        body: "A mobile number and email let the clinic send reminders (only with the patient's consent). PhilHealth and other identifiers are optional.",
        target: "card:Contact & identifiers",
      },
      {
        title: "Register",
        body: "If the system finds similar records, you review them before deciding that this is a new person. Registering is the start of the patient's single record.",
        target: "button:Register patient",
      },
    ],
  },
  {
    id: "patient-record",
    title: "The patient record",
    description: "Banner, tabs, actions and the clinical summary.",
    version: 1,
    matches: patientRecord,
    permissions: ["patient.read"],
    steps: [
      {
        title: "Who this is",
        body: "The banner shows the patient and any recorded allergies. “Allergies not recorded” means nobody has asked yet, which is different from “no known allergies”.",
        target: 'header[aria-label="Patient banner"]',
      },
      {
        title: "Actions",
        body: "From here you can book an appointment, check the patient in as a walk-in, open their billing, or start a consultation when one is due.",
        target: "button:Check in",
      },
      {
        title: "Sections",
        body: "Overview, clinical history, visits, laboratory, coverage and consent each have a tab.",
        target: 'nav[aria-label="Sections of the patient record"]',
      },
      {
        title: "Clinical summary",
        body: "Allergies, problems, active medicines, latest vitals and recent consultations at a glance. For a fuller one-screen view, open Patient 360.",
        target: "#clinical-summary",
      },
    ],
  },
  {
    id: "appointments",
    title: "Appointments",
    description: "The day schedule: confirm, check in, reschedule.",
    version: 1,
    matches: exact("/appointments"),
    permissions: ["appointment.read"],
    steps: [
      { title: "Choose the day", body: "Move between days, or jump to today.", target: 'nav[aria-label="Change day"]' },
      { title: "Filter and lay out", body: "Show one practitioner, or lay the schedule out by doctor or by room.", target: "#practitioner-filter" },
      { title: "The day schedule", body: "Each doctor or room has a card listing its appointments in time order.", target: 'main [data-slot="card"]' },
      {
        title: "Confirm and check in",
        body: "Confirm an appointment when the patient has confirmed. When they arrive, Check in puts them in the queue for triage. Rows also let you cancel, mark a no-show or move the appointment with a reason.",
        target: "button:Check in || button:Confirm",
      },
    ],
  },
  {
    id: "appointments-new",
    title: "Booking an appointment",
    description: "Pick a patient, a doctor and an open slot.",
    version: 1,
    matches: exact("/appointments/new"),
    permissions: ["appointment.manage"],
    steps: [
      {
        title: "Patient",
        body: "Search for the patient first; the booking is made on their record.",
        target: 'section[aria-labelledby="pick-patient"] || #practitioner',
      },
      { title: "Doctor, visit type and day", body: "Choose who the patient will see, what kind of visit it is and the day.", target: "#practitioner" },
      { title: "Open slots", body: "Only slots the doctor's schedule leaves open are offered.", target: 'section[aria-labelledby="slots-heading"]' },
      { title: "Book", body: "Add the reason for the visit and book. The patient can then be reminded, and checked in on the day.", target: "#reason" },
    ],
  },
  {
    id: "queue",
    title: "The queue",
    description: "The live board: who is waiting, calling and routing patients.",
    version: 1,
    matches: exact("/queue"),
    permissions: ["clinic.queue.read"],
    steps: [
      {
        title: "Live queue",
        body: "Every patient checked in today has a ticket here. The board updates by itself; the refresh button is the fallback.",
        target: 'button[aria-label="Refresh the queue"] || main h1',
      },
      {
        title: "Check in a patient",
        body: "Find the patient first, then check them in as a walk-in from their record. Booked patients are checked in from Appointments.",
        target: 'a[href="/patients"]',
      },
      {
        title: "Queue figures",
        body: "How many are waiting, in consultation and done, and how long the wait is.",
        target: 'section[aria-label="Queue figures"]',
      },
      {
        title: "The board",
        body: "Tickets sit in columns by stage and are ordered by priority, then arrival. Select a ticket to open its panel.",
        target: 'section[aria-label="Queue columns"] || ul[aria-label="Queue columns"] || section[aria-label="Waiting"]',
      },
      {
        title: "The ticket panel",
        body: "Call the patient to a room, open triage and vital signs, send them to another service point, and start the consultation. Its timeline lists what happened to the ticket.",
        target: 'aside[aria-label^="Ticket "]',
      },
    ],
  },
  {
    id: "walk-in",
    title: "Walk-in check-in",
    description: "Putting an arriving patient in the queue.",
    version: 1,
    matches: exact("/queue/walk-in"),
    permissions: ["clinic.queue.manage"],
    steps: [
      { title: "The patient", body: "Confirm this is the right person before checking in.", target: '[data-slot="card-title"]' },
      {
        title: "Visit type and priority",
        body: "Say what kind of visit it is and whether it is urgent. The nurse confirms the priority at triage.",
        target: "#visitType",
      },
      { title: "Reason and doctor", body: "A short reason helps the nurse; choose a doctor if the patient asked for one.", target: "#complaint" },
      { title: "Check in", body: "The patient gets a ticket and waits for triage.", target: "button:Check in" },
    ],
  },
  {
    id: "triage",
    title: "Triage and vital signs",
    description: "Complaint, vitals, priority and notes for the doctor.",
    version: 1,
    matches: triage,
    permissions: ["clinic.queue.manage"],
    steps: [
      {
        title: "The patient",
        body: "Name, allergies and how long they have waited. Check the allergies before anything else.",
        target: 'header[aria-label="Patient banner"]',
      },
      { title: "Chief complaint", body: "In the patient's own words why they came today.", target: "#chiefComplaint" },
      {
        title: "Vital signs",
        body: "Blood pressure, pulse, temperature and so on. Values outside a plausible range are refused, and unusual ones are flagged to you — they are prompts, not diagnoses.",
        target: "card:2 · Vital signs || section:2 · Vital signs",
      },
      {
        title: "Priority and risk",
        body: "Set the queue priority and any risk flags. The doctor and the queue use it to order patients.",
        target: '[aria-labelledby="priority-label"]',
      },
      { title: "Notes for the provider", body: "Anything the doctor should know before the consultation.", target: "#notes" },
      {
        title: "Complete triage",
        body: "Saves the assessment and moves the patient on to wait for the doctor. Save draft keeps your work without completing.",
        target: "button:Complete triage",
      },
    ],
  },
  {
    id: "encounters",
    title: "Today's consultations",
    description: "Consultations to open, continue or sign.",
    version: 1,
    matches: exact("/clinic/encounters"),
    permissions: ["encounter.read"],
    steps: [
      {
        title: "Today's consultations",
        body: "Patients waiting for a doctor, and consultations already in progress, for the facility you selected.",
        target: 'main [data-slot="card"]',
      },
      {
        title: "Open one",
        body: "Open starts or continues the consultation in the workspace. A signed consultation can only be changed by an amendment.",
        target: 'a[href^="/clinic/encounters/"]',
      },
    ],
  },
  {
    id: "encounter-workspace",
    title: "The consultation workspace",
    description: "Notes, diagnoses, prescriptions, orders and signing.",
    version: 1,
    matches: encounter,
    permissions: ["encounter.read"],
    steps: [
      {
        title: "One workspace",
        body: "Everything for this consultation is on one screen, with the patient's earlier visits on the left and their allergies, vitals and triage on the right. On a smaller screen these become tabs.",
        target: 'section[aria-label="Current encounter"] || section[aria-label="Encounter"]',
      },
      {
        title: "The note",
        body: "Write the note under Subjective, Objective, Assessment and Plan. Drafts are saved as revisions, so nothing is lost; Ctrl+S saves.",
        target: 'section[aria-label="Current encounter"] textarea',
      },
      {
        title: "Diagnoses",
        body: "Record diagnoses with the coding system your clinic uses. They can drive reports and billing, so enter what you actually concluded.",
        target: 'section[aria-labelledby="dx-heading"]',
      },
      {
        title: "Prescribing",
        body: "Prescriptions are checked against the patient's recorded allergies. The check is decision support: you can override it with a reason, and the override is recorded.",
        target: 'section[aria-labelledby="rx-heading"]',
      },
      {
        title: "Laboratory orders",
        body: "Order tests here; they go straight to the laboratory's worklist and the results return to this patient's record.",
        target: 'section[aria-labelledby="lab-orders-heading"]',
      },
      {
        title: "Clinical context",
        body: "Allergies, triage, latest vitals and history beside the note. This is also where Patient 360 opens.",
        target: 'section[aria-label="Clinical context"]',
      },
      { title: "Follow-up", body: "Book the next visit from the bar at the bottom with a preset interval.", target: 'a[href^="/appointments/new"]' },
      {
        title: "Sign to complete",
        body: "Signing completes the consultation and charges its services to billing. After signing, changes are made as amendments with a reason; the original stays in the history.",
        target: "button:Sign encounter || button:Amend note || button:Save draft",
      },
    ],
  },
  {
    id: "laboratory-worklist",
    title: "The laboratory workbench",
    description: "From specimen collection to released results.",
    version: 1,
    matches: (p) => under(p, "/laboratory/worklist"),
    permissions: ["lab.order.read"],
    steps: [
      {
        title: "Workbench",
        body: "Orders from consultations arrive here. The line under the title shows STAT orders, send-outs and critical results.",
        target: "main h1",
      },
      {
        title: "Stages",
        body: "Work moves through Collect, Receive, Enter results, Verify, Approve and Release. Each stage lists what is waiting for it.",
        target: 'nav[aria-label="Worklist stage"]',
      },
      {
        title: "Scan a barcode",
        body: "Scan the accession barcode on a specimen label to find its order.",
        target: 'input[aria-label="Scan accession barcode"]',
      },
      {
        title: "The worklist",
        body: "Select an order to open its details beside the list. A released result is never overwritten: corrections become new versions.",
        target: "main table",
      },
    ],
  },
  {
    id: "billing-desk",
    title: "The cashier's desk",
    description: "Charges to invoice, drafts and balances.",
    version: 1,
    matches: exact("/billing"),
    permissions: ["billing.charge.read"],
    steps: [
      {
        title: "Charges appear by themselves",
        body: "Services done in consultations, the laboratory and dental procedures become charges when they happen.",
        target: "card:To invoice",
      },
      { title: "Prepare an invoice", body: "Open a patient to choose which charges go on an invoice.", target: "card:To invoice" },
      {
        title: "Drafts and balances",
        body: "Invoices still being prepared, and issued invoices with money still owed.",
        target: "card:Drafts in progress || card:Balances owed",
      },
    ],
  },
  {
    id: "billing-patient",
    title: "A patient's billing",
    description: "Charges, deposit and invoices.",
    version: 1,
    matches: billingPatient,
    permissions: ["billing.charge.read"],
    steps: [
      {
        title: "Charges to invoice",
        body: "Tick the charges to bill together and prepare the invoice. A mistaken charge can be cancelled with a reason.",
        target: "card:Charges to invoice",
      },
      { title: "Prepare invoice", body: "Creates a draft you can still change: discounts, coverage and lines.", target: "button:Prepare invoice" },
      {
        title: "Deposit and credit",
        body: "Money the patient left on account, and credit that can be applied to an invoice.",
        target: "card:Deposit and credit",
      },
      { title: "Invoices", body: "Earlier invoices of this patient; open one to print it or take a payment.", target: "card:Invoices" },
    ],
  },
  {
    id: "billing-invoice",
    title: "An invoice",
    description: "Lines, discounts, coverage, issuing and payment.",
    version: 1,
    matches: invoice,
    permissions: ["billing.charge.read"],
    steps: [
      {
        title: "The invoice",
        body: "Its number and status. A draft can be changed freely; an issued invoice is never edited — mistakes are fixed with credit or debit notes, or by voiding.",
        target: "main h1",
      },
      { title: "Lines", body: "What is being billed. Remove a line from a draft if it does not belong.", target: "card:Lines" },
      {
        title: "Discounts",
        body: "Apply one of your organization's discount rules; the evidence (such as an ID) is recorded with it.",
        target: "card:Discounts",
      },
      {
        title: "HMO, PhilHealth and other payers",
        body: "Record how much a payer covers and its reference. The platform records the coverage; it does not decide eligibility.",
        target: "card:HMO, PhilHealth and other payers",
      },
      { title: "Issue", body: "Issuing gives the invoice its number and locks it. Check the lines and the total first.", target: "button:Issue invoice" },
      {
        title: "Payments and receipt",
        body: "Record the amount, method and reference. Each payment gets a receipt you can print, and refunds need a reason.",
        target: "card:Payments",
      },
    ],
  },
  {
    id: "pharmacy",
    title: "Pharmacy",
    description: "Finding a prescription and dispensing from stock.",
    version: 1,
    matches: (p) => under(p, "/pharmacy"),
    permissions: ["prescription.dispense"],
    steps: [
      { title: "Find a prescription", body: "Enter the prescription number printed on the prescription.", target: "#rx-number" },
      { title: "Today's dispenses", body: "What has been dispensed today at this facility; open one to see or reverse it.", target: "main table" },
      {
        title: "Dispensing",
        body: "Open a prescription to dispense: stock leaves inventory at the same moment, first-expiry-first-out. A mistaken dispense is reversed with a reason, never deleted.",
        target: "card:Dispense",
      },
    ],
  },
  {
    id: "telemedicine",
    title: "Online consultations",
    description: "Waiting room, questionnaire answers, video and chat.",
    version: 2,
    matches: (p) => under(p, "/telemedicine") && !under(p, "/telemedicine/settings"),
    permissions: ["telemedicine.read"],
    steps: [
      {
        title: "Video status",
        body: "If a notice appears at the top, video is not set up or the video server is not answering. Until it is back, call patients on the callback number from their answers. During a call the consultation has a chat for the same reason.",
        target: '[data-slot="callout"]',
      },
      {
        title: "Today's online consultations",
        body: "Each row shows the patient, how far they have got (questionnaire, waiting room) and who will see them.",
        target: "main table",
      },
      {
        title: "Review and start",
        body: "Read the patient's answers before starting. Some conditions need an in-person visit, and the doctor can escalate during the call.",
        target: "button:Review and start || button:Open consultation || button:Review answers",
      },
    ],
  },
  {
    id: "dental",
    title: "Dental",
    description: "Dental consultations and charts.",
    version: 1,
    matches: (p) => under(p, "/dental"),
    permissions: ["dental.record.read"],
    steps: [
      {
        title: "Dental consultations",
        body: "A dental visit is a consultation with a dentist. Open a patient to see their tooth chart, examinations, treatment plans and procedures.",
        target: 'ul[aria-label="Dental consultations"] || main h1',
      },
      { title: "Find a patient", body: "Dental work is kept on the same patient record as everything else.", target: 'a[href="/patients"]' },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Stock by location, lot and expiry.",
    version: 1,
    matches: (p) => p === "/inventory",
    permissions: ["inventory.read"],
    steps: [
      {
        title: "Filters",
        body: "Narrow the stock list, for example to items running low or expiring soon, or to one location.",
        target: 'nav[aria-label="Filter"]',
      },
      {
        title: "Stock",
        body: "Usable quantity per item and location, its reorder level and the lots with the earliest expiry first. Stock only changes through recorded movements.",
        target: "main table",
      },
    ],
  },
  {
    id: "messages",
    title: "Patient messages",
    description: "Conversations patients start from MyHealth.",
    version: 1,
    matches: exact("/messages"),
    permissions: ["patient.message.read"],
    steps: [
      {
        title: "Views",
        body: "Switch between conversations waiting for a reply and others; “mine” shows the ones assigned to you.",
        target: 'nav[aria-label="View"]',
      },
      {
        title: "Conversations",
        body: "Open one to read and reply. Messages are not for emergencies, and notices to the patient never include the message itself.",
        target: "main table",
      },
    ],
  },
  {
    id: "records-requests",
    title: "Records requests",
    description: "Patients' requests for their records.",
    version: 1,
    matches: exact("/records/requests"),
    permissions: ["patient.records-request.manage"],
    steps: [
      {
        title: "Requests",
        body: "Patients ask for copies of their records, or for a correction, erasure or objection, from MyHealth.",
        target: 'nav[aria-label="View"]',
      },
      {
        title: "Answer",
        body: "Open a request to share documents or decline with a reason the patient reads. The platform changes or deletes nothing by itself.",
        target: "main table",
      },
    ],
  },
  {
    id: "management",
    title: "Management dashboard",
    description: "Figures for a period, with comparisons.",
    version: 1,
    matches: exact("/management"),
    permissions: ["management.dashboard.read"],
    steps: [
      {
        title: "Choose a period",
        body: "Set the dates and facility, and what to compare with. Quick ranges are beside the form.",
        target: 'form[aria-label="Filters"]',
      },
      {
        title: "Key figures",
        body: "Headline numbers with their change since the comparison period, and whether the change is better or worse.",
        target: 'section[aria-label="Key figures"]',
      },
      {
        title: "Tables and exports",
        body: "Each table can be downloaded as CSV, and the whole dashboard as a PDF. “How is this calculated?” explains every figure.",
        target: "main details",
      },
    ],
  },
];

/** The tours listed to someone with these permissions (the app tour and the visit overview are for everyone). */
export function toursForPermissions(permissions: readonly string[]): TourDef[] {
  const granted = new Set(permissions);
  return TOURS.filter((t) => !t.permissions || t.permissions.some((p) => granted.has(p)));
}
