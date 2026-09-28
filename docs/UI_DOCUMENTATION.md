# FERN User Interface Documentation

**Version 2.0 · 27 September 2026 · https://hospital-ref.vercel.app**

This document describes every screen of FERN, the hospital emergency readiness and inter-hospital referral platform: who sees it, what it shows, what can be done on it, and how it behaves on a phone, a ward tablet, a desktop browser and as an installed app. It is written for the people who use FERN every shift, the administrators who run it for a facility or for the network, and the team that maintains it. Technical contracts (database, security, API) live in the companion documents in the same folder.

---

## 1. Conventions used in this document

- **Level** means one of the three access levels: System, Hospital, Department. **Role** means one of the five roles the database enforces. Section 3 explains both.
- **Traffic light** means a department's readiness state: Green (current), Yellow (overdue), Red (stale).
- Screen names are written in bold the first time they appear in a section, for example **Dashboard**. Buttons and controls are written as they appear on screen, for example *New referral*.
- Paths such as `/referrals/new` are the addresses in the browser. Every list screen keeps its filters in the address, so a filtered view can be bookmarked or shared.
- "Phone", "tablet" and "desktop" refer to the layout breakpoints in section 11, not to specific devices.

---

## 2. Getting in and out

### 2.1 Sign in

The **Sign-in** screen (`/login`) has two tabs.

| Tab | What it needs | When to use it |
| --- | --- | --- |
| Password | Work email and password | Everyday sign-in for accounts that have set a password |
| Email code | Work email only | First sign-in after an invitation, shared ward terminals, or when the password is forgotten |

*Email code* sends a six-digit code that expires after a short time. The code screen has *Resend code* (available again after 30 seconds) and *Change email*. *Forgot password?* on the Password tab sends a reset link to the address typed above it.

On a wide screen the left half of the page is a brand panel with the FERN wordmark and four one-line descriptions of what the platform does. On a phone the wordmark sits above the form. The footer names the support address configured for the network.

There is no public sign-up. An address that has not been invited is refused by the server, and the message says so.

### 2.2 Accounts, invitations and first sign-in

Administrators create access by recording an **invitation**: the email address, the level and role, the hospital and, for a Department-level account, the department. The person then chooses *Email code* on the sign-in screen with that same address. Their account is created on the spot with exactly the access recorded, and the invitation is marked accepted. Invitations expire after 30 days and can be revoked before they are used.

### 2.3 Password reset

A reset link opens the **Reset password** screen (`/reset-password`). It asks for the new password twice, shows the FERN wordmark and the support address, and explains if the link has expired or been used already. Accounts flagged by an administrator as "must change password" are sent here automatically after signing in.

### 2.4 Session, sign-out and the sign-in log

- A session persists in the browser until *Sign out* is used or the account is deactivated. Deactivation takes effect at the account's next request.
- *Sign out* is the icon at the bottom of the sidebar (and inside the More drawer on a phone). It records an audit event and returns to the sign-in screen.
- Every successful sign-in is recorded with the method used (password, email code or recovery link), the browser and device, and the network address as seen by the server. A person can see their own history; hospital administrators see their facility's; system administrators see the network's (section 9.4).

### 2.5 Installing FERN as an app

FERN is a progressive web app. Installed, it opens in its own window with no browser bars, starts faster, and keeps an icon in the taskbar, dock or home screen.

| Platform | How to install |
| --- | --- |
| Windows, macOS, ChromeOS (Chrome or Edge) | *Install app* in the sidebar, the *Install FERN as an app* action in the search palette, the install banner that appears a few seconds after the first screen, or the install icon in the browser's address bar |
| Android (Chrome, Edge, Samsung Internet) | The same three places in the app, or the browser menu |
| iPhone and iPad (Safari) | Share → *Add to Home Screen*. The app explains this in the sidebar and in a banner, because Safari offers no install prompt of its own |

On desktop the installed window takes over its title bar: the operating system draws only its buttons and FERN paints a slim strip with the mark, the app name and the current hospital. Clicking the taskbar icon focuses the open window rather than opening a second copy.

When a new version has been deployed, an installed app shows a quiet *A new version is ready* card with *Reload* and *Later*. It never reloads on its own, so a form in progress is never lost.

### 2.6 Theme and branding

The sidebar footer has a three-way switch: **System** (follow the device), **Light**, **Dark**. The choice is kept on the device. Charts, toasts, the browser chrome colour and the network logo all follow it: the FERN wordmark is dark ink on light surfaces and white on dark ones.

A system administrator can re-brand the network for everyone (section 9.7): brand colour, a logo for light surfaces, a logo for dark surfaces, the application name and tagline, and the support address. Each hospital additionally has its own logo (section 8.1).

---

## 3. Access levels and roles

People are managed at three levels. A role says *what* a person may do; the level says *where*. Both are enforced by the database, not only by the interface.

| Level | Roles | Scope |
| --- | --- | --- |
| **System** | System Administrator | The whole platform: every hospital, every account, the emergency catalogue, scoring, branding, the sign-in log and the network-wide audit trail. Developers and the programme office. |
| **Hospital** | Hospital Administrator, Referral Coordinator, Viewer | One facility: its settings, every department's readiness, its staff, the referrals it sends and receives, its reports. Hospital-level accounts also see other facilities' department boards, because choosing where to refer is a cross-hospital question. |
| **Department** | Shift In-Charge, Department Coordinator | One department in one facility: sees and files readiness for that department only, follows the referrals raised from it, and is never shown the rest of the building. A Department Coordinator may also raise referrals from the department where the hospital's **Referral initiation** setting allows (section 9.1). |

A department-level account must have a department. One without a department sees a warning on every page and can act on nothing until an administrator assigns one.

### 3.1 What each role can do

| Capability | System Admin | Hospital Admin | Referral Coordinator | Department Coordinator | Shift In-Charge | Viewer |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| See readiness boards and the hospital directory | Yes | Yes | Yes | Own department | Own department | Yes |
| Submit a department's shift readiness update | Yes | Yes | – | Own department | Own department | – |
| See referrals involving the hospital | Yes | Yes | Yes | Own department's | Own department's | Yes |
| Raise a referral | Yes | Yes\* | Yes\* | Yes\* | – | – |
| Accept, decline, move and complete referrals | Yes | Yes | Yes | – | – | – |
| Chat on a live referral | Yes | Yes | Yes | Yes | Yes | – |
| Attach imaging and results to a live referral | Yes | Yes | Yes | Yes | Yes | – |
| Reports for the hospital | Yes | Yes | Yes | – | – | Yes |
| Reports for every hospital | Yes | – | – | – | – | – |
| Administer the hospital (settings, departments, staff) | Yes | Yes | – | – | – | – |
| Read the audit log | Yes (network) | Yes (hospital) | – | – | – | – |
| System console | Yes | – | – | – | – | – |

\* Subject to the hospital's **Referral initiation** setting: *Hospital only* (the default) lets hospital-level roles refer, *Departments only* lets Department Coordinators refer, *Hospital and departments* lets both. A role without referral rights never refers, whatever the setting.

A screen a role may not open shows a plain *Not available for your role* card rather than an error. The database applies the same rules independently of the interface.

### 3.2 Who sees which navigation

| Destination | Shown to |
| --- | --- |
| Dashboard | Everyone |
| Readiness | Everyone |
| Referrals | Everyone |
| Hospitals | Everyone |
| Reports | Hospital-level and system accounts |
| Administration | Hospital Administrators, and System Administrators who are attached to a hospital |
| System console | System Administrators |

---

## 4. The application shell

### 4.1 Desktop and tablet

- **Sidebar** (left, fixed): the FERN wordmark and tagline, the main navigation with the active item marked by colour and a bar, an unread badge on *Referrals* for incoming requests still pending, then the footer: the signed-in person's initials, name and "Level · Role", *Install app* when available, the theme switch and *Sign out*. On tablets the sidebar becomes a drawer opened from the header.
- **Header** (top, sticky): the hospital's logo, name and rolled-up traffic light with "n/m departments current"; a *Not accepting referrals* badge when the facility is on diversion; a search box that opens the palette (*Ctrl K* or *⌘K*); the notifications bell with an unread count.
- **Global activity bar**: a thin brand-coloured bar under the top edge while a screen is waiting on its first data or a save is in flight. Background refreshes never show it.

### 4.2 Phone

- **Bottom tab bar**: the first four destinations plus *More*, which opens the full navigation drawer with the same footer as the desktop sidebar. The referrals tab carries the pending badge.
- **Header**: logo, hospital name and traffic light, a search icon and the bell.
- Content respects the notch and home indicator. Long lists become stacked cards; secondary filters sit behind a *More filters* toggle; statistics tiles sit two per row.

### 4.3 Search everywhere

The **search palette** opens with *Ctrl K* (*⌘K* on Apple platforms), the header search box, the search icon on a phone, or by pressing */* when no field has focus. It searches, in one place:

| Group | Matches on | Opens |
| --- | --- | --- |
| Pages and actions | Names and synonyms ("refer", "inbox", "install", "dark") | The page, or runs the action |
| Hospitals | Name, code, town, region, level | The hospital's page |
| Your departments | Department name and type | The readiness form for it |
| Referrals | Reference number, patient code, summary text | The referral |
| People (administrators only) | Name or email | Staff or Users, filtered to that person |

Arrow keys move, *Enter* opens, *Esc* closes. The palette remembers the last six things opened from it. On a phone it becomes a full-height sheet with a *Close* button.

### 4.4 Notifications and toasts

Arrivals that need a person (an incoming referral, an acceptance or decline, a new message, an overdue department) appear as a toast with a *View* link and remain in **Notifications** until read. On a desktop the toasts sit at the bottom right; on a phone they drop in from the top, because the tab bar owns the bottom edge. Ordinary toasts last six seconds and critical ones twelve. An **incoming referral** is different: its toast stays on screen until it is opened (*Open referral*) or dismissed, and it plays a short two-tone chime, as does any critical alert. The speaker button beside the theme switch in the sidebar mutes the chime on that device. Notifications follow scope: a department-level account is alerted about its own department's readiness and about messages on referrals raised from its department, not about the rest of the hospital.

### 4.5 Loading, empty and error states

Every screen has three deliberate states besides its content:

- **Loading**: a skeleton in the shape of the coming screen (tiles, cards, table rows) rather than a spinner, so nothing jumps when the data lands. Processes with no shape of their own, such as ranking hospitals or signing in, show a spinner with words.
- **Empty**: an icon, a one-line title and a sentence saying what would fill the screen, plus the action that does so where one exists.
- **Error**: a red *Could not load this* card with the reason and *Try again*. A failed background save shows a toast; the form is not cleared.

Buttons that start a save show a spinner and cannot be pressed twice.

---

## 5. Dashboard

Path `/`. Every sign-in lands here. It is ordered by what the person has to do, not by what is easiest to render.

### 5.1 For a hospital-attached account

1. **Greeting** with the person's first name (honorifics stripped), the hospital and role, the current shift and how long is left in it, and the hospital's traffic light chip.
2. **Needs attention**: up to six items, most urgent first, each with a button: incoming referrals waiting past the 15-minute response target, departments three or more shifts stale, then referrals sent and unanswered and departments one or two shifts overdue. The band disappears entirely when nothing is outstanding.
3. **Need to move a patient?** with *New referral* (for roles the hospital's referral initiation setting lets raise one), beside **Your shift update** for an account with a department of its own (that department's light, who last reported and when, *Submit readiness update* or *Amend this shift*) or **Readiness still owing** for other submitters (the departments not yet reported this shift).
4. **Five tiles**: departments current, awaiting our response (with how many are past target), sent and awaiting reply, completed in seven days, average response time in seven days.
5. **Department readiness**, the compact board (section 6.2) with *Open board*.
6. **Referral trend, last 7 days**: a chart of referrals raised, accepted and completed per day.
7. **Recent incoming** and **Recent outgoing**: the last five referrals in each direction as cards with *View all*.

### 5.2 For a network-wide account

A System Administrator with no home hospital sees instead: a card linking to the **System console**; **Network overview** tiles (active hospitals and how many accept referrals, referrals in seven days and acceptance rate, pending network-wide, average response); **Lowest readiness compliance, last 7 days** listing the six hospitals missing the most shift updates with a meter each; and the network-wide referral trend.

An account attached to no hospital and without network rights sees a warning explaining that an administrator has to attach it before anything can be shown.

### 5.3 For a department-level account

A Shift In-Charge or Department Coordinator lands on a dashboard built around their own department and nothing else:

1. **Greeting** naming the hospital, the department and the role, with the shift chip.
2. **Needs attention**, limited to the department's own readiness and to the referrals raised from it.
3. **Your shift update** (the department's light, last report, *Submit readiness update* or *Amend this shift*) beside **Need to move a patient?** when the hospital lets departments refer; otherwise a short note saying who raises referrals at this hospital.
4. **Four tiles**: the department's status, when it last reported and by whom, referrals from the department awaiting a reply, referrals completed in seven days.
5. **Recent submissions** for the department (seven days) and **Referrals from your department**.

No hospital-wide figures appear, and none can be reached by address: the database returns only the department's rows to this account. An account whose department has not been set sees a warning instead of the panels.

---

## 6. Readiness

### 6.1 How the traffic light works

- The day has three shifts: **Morning 07:00–15:00**, **Afternoon 15:00–23:00**, **Night 23:00–07:00**, evaluated in the hospital's own timezone.
- Each department that is on the shift rota files one update per shift. **Green** means updated for the current shift; **Yellow** means one or two shifts have passed without an update; **Red** means three or more, or never.
- A hospital is only as green as its least-current department. The light changes on the clock, not only when data changes: a board left open turns yellow at the shift boundary by itself.
- Referring hospitals see a scoring penalty against a yellow (−15 %) or red (−35 %) facility, and a scheduled job alerts the hospital's administrators when a department falls behind.

### 6.2 Departmental readiness board

Path `/readiness`. For a hospital-level account (a department-level account sees section 6.5 at the same address).

- Header with the hospital name, the timezone shifts are shown in, and a chip with the current shift and time remaining.
- Four tiles: reported this shift, overdue, stale, compliance (percentage of reporting departments that are current).
- An *Action needed* banner when any department is overdue or stale.
- **Departments**: a search box (department name, type, or who last reported), a department-type filter when more than one type is present, and chips *All / Current / Overdue / Stale* with counts. Each row shows the light, the name, a status badge, how many shifts overdue, who reported and when, the department type and the last shift filed, and *Update now* for roles that can submit. Overdue and stale rows sort first; departments off the rota sink to the bottom.

### 6.3 Shift readiness update form

Path `/readiness/<department>`. For roles that can submit, and only for a department in scope: a department-level account may open its own department's form, a hospital-level account any department of its own hospital. Anything else shows a *Not your department* card, and the database refuses the submission independently.

- The header names the department and the shift being filed, and says whether this shift has already been reported (in which case the form amends it).
- Fields are decided by the department's **template** (Emergency, Main Theatre, ICU, NICU, Maternity, Surgery, Radiology, Blood Bank, Renal, Cardiology, Burns, General Ward). Counts have a capacity companion (for example ICU beds free of total), yes/no resources are switches, oxygen is a percentage. The Blood Bank template also collects units per blood group; the Emergency template also sets the hospital-wide *Emergency unit open / on diversion* flag with a reason.
- The form pre-fills with the hospital's current values, autosaves a draft on the device, and asks for confirmation before submitting. After submission the department's light turns green immediately for everyone.
- A **history** panel lists recent submissions for the department with who filed them and their notes.

### 6.4 Network readiness

Path `/readiness` for a System Administrator with no home hospital.

Four tiles (hospitals; fully current; overdue; stale, with the share of all departments current), a filter bar (search across hospitals and departments, region, level, readiness chips) and one card per hospital, worst first: logo, name, status badge, "n/m current", a coloured strip with one segment per department, the departments still owing with how long ago they last reported, and *Open hospital*.

### 6.5 Department readiness view

Path `/readiness` for a department-level account. The header names the department; below it **Your shift update** (light, last report, the submit or amend button), **Recent submissions** over fourteen days, and a note that the hospital-wide board is a hospital-level view. There are no hospital tiles and no list of other departments.

---

## 7. Referrals

### 7.1 Referral list

Path `/referrals`. Address parameters: `tab`, `q`, `status`, `urgency`, `type`, `hospital`, `from`, `to`, `sort`.

- Header: how many incoming referrals await a response, *Export CSV* (roles with reports), *New referral* (roles that can raise one).
- Filter bar, always visible: direction (**Incoming / Outgoing / All** with live counts), a search box (reference, patient code, hospital, emergency, summary or requester), a sort (newest, oldest, most urgent, longest waiting), and status chips for the seven statuses. Urgency, emergency type, the other hospital, and the requested-from / requested-to dates sit in a second row that folds behind *Filters* on a phone.
- Each **referral card** shows the reference number, status and urgency badges, the match score at the time of referral, the other hospital's logo, name and town, the emergency type and patient code, when it was requested, distance and estimated travel time, and *View details*. Incoming pending referrals carry *Accept* and *Decline* inline; overdue ones get an amber border and a waiting-time strip. On the Incoming tab overdue requests float to the top.
- *Decline* asks for a reason of at least five characters that the referring hospital will see.
- A network-wide account sees only the All tab.

### 7.2 New referral

Path `/referrals/new`. Three steps with a progress stepper; earlier steps can be revisited.

**Step 1 – The case.** Emergency type (grouped catalogue with a description and the default urgency), urgency (Critical, Urgent, Routine), age band, sex, a clinical summary of up to 1,000 characters, the search radius in kilometres with *+50 km* and *+100 km*, and additional required resources grouped by critical care, surgical, diagnostics, supplies and logistics. Anything ticked becomes a hard requirement. No patient name, date of birth, national ID or record number is ever asked for; a non-identifying patient code is generated.

**Step 2 – Ranked hospitals.** While the ranking runs the screen shows *Ranking nearby hospitals* with a spinner. Then every facility within the radius appears as a card: rank, name, level and town, traffic light and how long since it updated, road distance and estimated travel time, a row of yes/no marks for theatre, surgeon, ICU, ventilators, oxygen, blood and CT, and the match score with a meter. *Recommended* marks the top eligible hospital; ineligible ones stay visible, greyed, with the reason. *Explain this score* opens the per-resource breakdown, the proximity sub-score and any penalty. Selection is always an explicit *Select*: nothing is chosen automatically. A note explains when two scores were within half a point and history settled the order.

**Step 3 – Confirm and send.** A summary of the case and the chosen hospital, its emergency and switchboard numbers as one-tap call links, a warning if a lower-ranked hospital was chosen over the recommendation, and *Send referral*. The referral is created with its score snapshot, the receiving hospital is notified in real time, and the screen moves to the referral's page.

**The score.** Match = 70 % resource fit + 30 % proximity, minus the readiness penalty. Each required resource contributes according to its weight and how much of it is free; a missing critical resource excludes the hospital outright, as does an emergency unit on diversion. Proximity is scored from the estimated travel time up to 180 minutes; hospitals beyond 250 km are not considered. These numbers are adjustable by a System Administrator (section 9.6).

### 7.3 Referral detail

Path `/referrals/<id>`.

- Header: reference number, status and urgency, the two hospitals with logos, and the action buttons for the viewer's side of the transfer.
- **Status machine**: Pending → Accepted or Declined; Accepted → In transit; In transit → Completed; Pending or Accepted → Cancelled by the referring hospital. Only the buttons the database will accept from this viewer are offered. *Complete* asks for an outcome (transferred and received, stabilised at referring facility, referred elsewhere, died before transfer, declined by patient or family, other) and notes.
- While a referral is **pending**, an *Awaiting response* banner counts the minutes. Past the 15-minute target it turns amber, past 30 minutes red, and from the target onwards it carries a red **Call now** button dialling the other facility's emergency line, so the phone call is one tap from the notice. *Cancel referral* is a red button; the *Call* button on the chat panel is red too, because it dials the emergency line.
- **Case** panel: emergency, urgency, age band, sex, summary, required resources, patient code, who requested it and from which department.
- **Attachments**: X-rays, scans and result sheets (JPEG, PNG, WebP or PDF, up to 20 MB each). Either facility can add files while the referral is live, everyone who can see the referral can open them (through a short-lived private link), and whoever uploaded a file can remove it. The panel repeats the rule that applies to the whole referral: no patient names, numbers, dates of birth or faces. Every upload is written to the audit log.
- **Ranking at the time**: the chosen hospital's score with its breakdown, and the alternatives considered.
- **Contact**: emergency and switchboard numbers with call links, the requesting and responding staff.
- **Timeline**: every status change with who, when and any note; immutable.
- **Messages**: a real-time chat between the two hospitals, open only while the referral is live (pending, accepted, in transit). New messages also raise a notification for the other side.
- *Print form* opens the referral form (section 7.4).

### 7.4 Printable referral form

Path `/referrals/<id>/form`. A fixed white A4 document outside the app chrome: the referring hospital's letterhead with its logo, address and numbers; the receiving facility block; the case details; the ranking used; the status timeline; signature lines. *Print this form* uses the browser's print dialog. The non-printing toolbar returns to the referral.

---

## 8. Hospitals

### 8.1 Hospital directory

Path `/hospitals`. Address parameters: `q`, `region`, `level`, `status`, `accepting`, `sort`, `view`.

- Header: a **Cards / Table** switch and, for System Administrators, *Add hospital*.
- Filter bar: search (name, code, town, region, address) and sort (distance from your hospital, name, readiness worst first, region, facility level) always visible; region, level, readiness chips with counts and *Accepting referrals only* fold behind *More filters* on a phone.
- **Card**: the hospital's logo (or a coloured monogram of its code when none has been uploaded), name, code and level, the rolled-up light with "n/m departments current", town and region, distance from your hospital, an *On diversion* badge when relevant, *Emergency* and *Switchboard* call links and *Details*. Your own hospital carries a ring and a *Yours* badge.
- **Table**: the same facts as columns, sortable, with call links per row. On a phone each row becomes a stacked card with its headings.

### 8.2 Hospital page

Path `/hospitals/<id>`.

- Header with logo, name, code, level, place and distance; *Refer a patient here* for coordinators; *Edit* for administrators with rights over it.
- A status strip: traffic light, departments current, *Yours*, *Not accepting referrals*, *Emergency unit closed*, and when resources were last updated. Diversion shows a red banner with the reason given by the emergency department.
- **Five capacity tiles**: ICU beds, NICU cots, ventilators, theatres, oxygen supply.
- **Resource snapshot**: every tracked resource grouped by critical care, surgical, diagnostics, supplies, logistics.
- **Blood stock** by group and **Contact** with address, call and email links, timezone and notes.
- **Department readiness** board for the facility.

---

## 9. Administration

### 9.1 Hospital administration

Path `/admin`, for Hospital Administrators (and System Administrators attached to a facility). Tabs: **Hospital**, **Departments**, **Staff**, **Audit log**. System Administrators also see a card pointing to the console for network-wide settings.

**Hospital.** Facility details (name, short code, level, timezone, address, town, region with the sixteen Ghanaian regions offered as suggestions, country, switchboard and emergency phones, email, notes), **Referral initiation** (who may raise referrals from this hospital: *Hospital only*, the default; *Departments only*; or *Hospital and departments*, each explained in place, with a warning when hospital-level roles are about to lose the button), the **logo** (upload a PNG, SVG, JPEG or WebP under 1 MB, paste an https link, or remove it to fall back to the monogram), the **location** with a link that opens the pinned position in OpenStreetMap so it can be checked against the compound, and a separate **Referral availability** switch. Turning referrals off asks for confirmation and removes the hospital from every ranking immediately.

**Departments.** The list with search, a template filter and *Show retired*; *New department* and *Edit* open a form with the name, the template (with a live summary of the readiness fields it brings), a contact phone and the *Requires a readiness update every shift* switch. Departments are retired, never deleted, so readiness history survives; a retired department can be restored.

**Staff.** Search (name, email, phone), an *Active / Deactivated / All* switch, role and department filters and level chips with counts; staff are grouped by level. Each row: initials, name, level · role badge, email, department, last sign-in, and *Edit* (role, department) or *Deactivate* / *Reactivate*. Nobody can change their own role or deactivate themselves. A department-level role cannot be saved without a department, in this form or in the console: the database refuses it as well. Below it, **Invite a colleague**: pick the level first, then the role, name, email and department (required at Department level), then *Create invitation*; pending invitations list with *Revoke*.

**Audit log.** Every readiness submission, referral decision and administrative change for the facility, filterable by date, action, entity type and actor email, expandable to the recorded detail, exportable to CSV.

---

### 9.2 System console

Path `/console`, System Administrators only. Tabs: **Overview**, **Hospitals**, **Users**, **Sign-ins**, **Emergency catalogue**, **Scoring**, **Appearance**, **Audit log**. Everything here is network-wide.

### 9.3 Overview

- When the figures were taken, and *Refresh*.
- Five tiles: active hospitals (accepting / on diversion), departments current (with updates in 24 h), referrals in 7 days (pending, in transit), active accounts (signed in today and this week), average response in 7 days (accepted, declined, completed).
- **Sign-ins, last 14 days** (bars per day with a line for distinct people) and **Referrals, last 14 days** (raised and completed).
- **Network readiness now** (share of departments current, hospitals by status), **Hospitals by region**, **Accounts by level** with a bar per role.
- **Needs attention**: counts that link straight to the filtered view that fixes them — referrals past the response target, hospitals with a stale department, emergency units on diversion, accounts with no hospital, accounts that have never signed in, pending invitations, hospitals with no reporting departments, hospitals without a logo.
- **Latest sign-ins** and **Latest audit events**.

### 9.4 Hospitals, Users and Sign-ins

**Hospitals.** Search, *Active / Inactive / All*, region, level, accepting and readiness filters; a table with logo, level, region, readiness, and inline **Accepting** and **Active** switches; per row *Departments* (opens the department manager for that facility), *Edit* and open. *Add hospital* opens the full facility form including the flags; a new facility gets its resource and blood-stock rows immediately and stays open so its logo can be uploaded.

**Users.** Five tiles (active accounts, and how many at each level, plus accounts needing attention), then search, status, hospital and role filters and level chips, and a sortable table: person, level · role, hospital (with *Not attached* warnings), department, last sign-in, joined, and actions. *Edit* can change the name, role, hospital (moving someone re-scopes everything they see), department and active flag. Below, **Invite a colleague** with a hospital picker.

**Sign-ins.** Tiles for the range, then email, hospital, from / to and method filters, a paged table (when, person, role, hospital, method, device, address) and *Export CSV*.

### 9.5 Emergency catalogue

The conditions a coordinator can refer for, and the resources each one needs. Search, *Active / Retired / All*, category and default-urgency filters. Each row shows the type, its code, category, default urgency and the resources it requires with their weights, critical ones in red. *Resources* opens the requirements editor: one row per resource with weight 0–10, minimum quantity for counted resources, and a *Critical* tick; a missing critical resource excludes a hospital outright. *Edit* changes the name, category, description, default urgency and sort order; types are retired, not deleted, so past referrals keep their meaning. Every change is audited and applies to the next referral raised anywhere.

### 9.6 Scoring

The ranking parameters with sliders and a worked example that recalculates live: the resource and proximity weights (70 / 30), the yellow and red penalties (15 % / 35 %), the maximum travel time and distance, the road-distance factor and fixed dispatch overhead, the tie-break tolerance, and whether red hospitals or hospitals on diversion are excluded outright.

### 9.7 Appearance

Brand colour (presets, a picker and a hex field; the ten derived shades are previewed and a contrast warning appears when white text would be hard to read on the chosen colour), the two logos with a live preview of the sidebar in both themes and a switching rule (follow the theme, or pin one), and the naming fields. Changes are previewed immediately and apply to everyone on save.

### 9.8 Audit log

The same viewer as the hospital audit log, across every hospital.

---

## 10. Reports

Path `/reports`. For roles with reports; the hospital picker appears only for network-wide accounts.

- **Period** presets (today, 7, 30, 90 days) or a custom from / to; *Print*.
- **Overview**: tiles for total referrals, acceptance rate, average and median response time, average completion time; a status breakdown, urgency chart, emergency-type chart and the daily trend; top receiving and referring hospitals. *Export CSV*.
- **Hospitals**: a sortable table of referrals sent, received, accepted, declined and completed, acceptance rate, average response and completion, and readiness compliance per hospital, with a response-time chart. *Export CSV*.
- **Compliance**: expected versus actual shift updates per department for the period, missed shifts, last submission, a compliance chart against the 80 % target. *Export CSV*.

Every export is recorded in the audit log.

---

## 11. Notifications

Path `/notifications`. An *Unread / All* switch, search, a type filter and severity chips; *Mark all as read* and, when filters are set, *Mark these as read*. Notifications are grouped by day (Today, Yesterday, then dates). Each row shows an icon for its type, the title and body, a type badge, when it arrived and *Open* when it links somewhere. Readiness alerts are raised automatically by the scheduled overdue check; the page explains this.

---

## 12. Design system

### 12.1 Colour

- **Brand**: one colour chosen by the network (default clinical blue `#1b5cf5`), from which eleven shades are derived for backgrounds, borders, hover states and dark mode. Text on brand surfaces automatically switches between white and near-black to stay readable.
- **Readiness**: Green `emerald-500`, Yellow `amber-500`, Red `red-500`, always paired with a word (Current, Overdue, Stale) and never carried by colour alone.
- **Status badges**: neutral, brand, success, warning, danger, info tones, each with a light and a dark variant.
- **Charts**: a validated categorical palette (blue, orange, aqua) with distinct light and dark steps; legends sit above the plot; every series is named in the legend and the tooltip.

### 12.2 Type and spacing

Inter, 14 px body, 12 px hints, 20 px page titles; controls are 40 px tall (32 px small), touch targets at least 44 px; cards have 20 px padding and 12 px radius; page gutters are 16 px on phones and 24 px above, widened automatically to clear a notch.

### 12.3 Components

| Component | Where it is used |
| --- | --- |
| Button (primary, secondary, outline, ghost, danger, success; small, medium, large, icon) | Every action; shows a spinner while working |
| Card, with header, body and footer | Every panel |
| Field with label, hint and error; Input, Select, Textarea, Checkbox, Toggle | Every form |
| Badge and StatusDot | Statuses, roles, levels, traffic lights |
| Chip and SegmentedControl | Filter pills and mutually exclusive choices |
| FilterBar with a "More filters" fold | Every list screen |
| SearchInput with clear button | Every list screen and the palette |
| Table with responsive card mode, sortable headings, Pagination | Console, directory, reports |
| Modal (a bottom sheet on phones) | Confirmations, editors |
| Toast | Results of actions and arrivals |
| Skeletons and loaders | Every loading state |
| HospitalLogo (with monogram fallback) and BrandLogo | Identity everywhere |

---

## 13. Responsiveness and accessibility

| Breakpoint | Width | Layout |
| --- | --- | --- |
| Phone | under 640 px | Bottom tab bar and More drawer; stacked filters with a fold; two-column tiles; tables as cards; modals as bottom sheets; full-height search sheet |
| Tablet | 640–1023 px | Header hamburger opens the navigation drawer; two-column grids |
| Desktop | 1024 px and above | Fixed sidebar; three-column grids; header search box; title-bar overlay when installed |

- Every interactive element has a visible focus ring; drawers and dialogs trap focus and close with *Esc*; skip-to-content is the first tab stop.
- Colour never carries meaning alone: every light, status and chart series has a word or icon.
- Reduced-motion preferences disable animations. Inputs are 16 px on phones so iOS does not zoom the page.
- Times are shown in the hospital's timezone; relative times ("12 min ago") refresh on their own so a wall-mounted screen never lies.

---

## 14. Glossary

| Term | Meaning |
| --- | --- |
| Current / Overdue / Stale | Green, yellow and red readiness: updated this shift; one or two shifts missed; three or more missed or never reported |
| Pending, Accepted, Declined, In transit, Completed, Cancelled, Expired | The referral statuses, in the order a referral moves through them |
| Critical, Urgent, Routine | Urgency bands: immediate; within hours; planned |
| Match score | 0–100 %: how well a hospital fits the case, 70 % resources and 30 % proximity, less any readiness penalty |
| Response target | 15 minutes for a receiving hospital to accept or decline |
| On diversion | The emergency unit has closed to new arrivals, or the hospital has switched off incoming referrals |
| Patient code | A generated non-identifying reference such as PT-7K3QF2; no patient identifiers are stored |
| Level · Role | The access level (System, Hospital, Department) and the role within it |

---

## 15. Address map

| Path | Screen |
| --- | --- |
| `/login`, `/reset-password` | Sign in, reset password |
| `/` | Dashboard |
| `/readiness`, `/readiness/<department>` | Readiness board or network board; shift update form |
| `/referrals`, `/referrals/new`, `/referrals/<id>`, `/referrals/<id>/form` | Referral list, new referral, referral page, printable form |
| `/hospitals`, `/hospitals/<id>` | Directory, hospital page |
| `/reports` | Reports |
| `/notifications` | Notifications |
| `/admin/hospital`, `/admin/departments`, `/admin/staff`, `/admin/audit` | Hospital administration |
| `/console`, `/console/hospitals`, `/console/users`, `/console/sign-ins`, `/console/catalogue`, `/console/scoring`, `/console/appearance`, `/console/audit` | System console |

Keyboard: *Ctrl K* / *⌘K* or */* opens search; *Esc* closes any dialog; *Tab* and *Shift Tab* move through controls; arrow keys move through search results and *Enter* opens one.
