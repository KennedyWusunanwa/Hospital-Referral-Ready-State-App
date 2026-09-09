# FERN — Acceptance Tests

Sixty-four manual test cases, executable by a person with a browser and two accounts. Each case
states its preconditions, the steps to take and the result that must be observed. A case passes only
if the expected result is observed exactly; "close enough" is a fail with a note.

Automated unit tests over the pure domain modules (`npm run test`) complement this suite but do not
replace it — they prove the arithmetic, these cases prove the system.

## How to run this suite

**Test accounts.** Create these before starting. Two hospitals are essential: several cases prove
that one cannot see the other.

| Alias | Role | Hospital | Notes |
| --- | --- | --- | --- |
| `SA` | `super_admin` | none | Cross-network administrator |
| `A-ADMIN` | `hospital_admin` | Hospital A | |
| `A-SHIFT` | `shift_in_charge` | Hospital A | Assigned to A's ICU department |
| `A-COORD` | `referral_coordinator` | Hospital A | |
| `A-VIEW` | `viewer` | Hospital A | |
| `B-COORD` | `referral_coordinator` | Hospital B | |
| `B-ADMIN` | `hospital_admin` | Hospital B | |

**Environment.** Run against a staging deployment seeded with `0004_seed.sql` and at least four
hospitals with realistic coordinates. Use two different browsers (or one plus a private window) so
two roles can be signed in at once.

**Recording.** Mark each case Pass / Fail / N-A in the Result column, with the date, the tester's
initials and — for a fail — a defect reference.

**Legend.** 🟢 green = current, 🟡 yellow = overdue, 🔴 red = stale.

---

## A. Authentication and session

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-01 | Sign in with a valid password | `A-COORD` exists and is active | 1. Open the app URL. 2. Enter the email and password. 3. Submit | Signed in within 3 s; the dashboard shows the user's name, role label ("Referral Coordinator") and Hospital A | |
| AT-02 | Reject a wrong password | As above | 1. Sign in with a deliberately wrong password | Error reads "Email or password is incorrect." No hint as to which was wrong. No session created | |
| AT-03 | Reject an unknown email | — | 1. Sign in with `nobody@example.org` and any password | The same "Email or password is incorrect." message. Account existence is not disclosed | |
| AT-04 | Sign in with an email one-time code | `A-SHIFT` has a reachable mailbox | 1. Choose the email-code option. 2. Enter the address. 3. Retrieve the code. 4. Enter it | Code arrives within 60 s; entering it signs the user in. Code is 6 digits and the email states a 10-minute expiry | |
| AT-05 | An expired one-time code is refused | AT-04 completed; wait past the configured expiry | 1. Request a code. 2. Wait 11 minutes. 3. Enter it | Sign-in fails with a clear expiry message; a new code can be requested | |
| AT-06 | Password reset round trip | `A-VIEW` has a reachable mailbox | 1. Use "Forgot password". 2. Open the emailed link. 3. Set a new password. 4. Sign in with it | The link opens `/reset-password` **on the production origin**; the new password works and the old one does not | |
| AT-07 | Sign out clears the session | Signed in as `A-COORD` | 1. Sign out. 2. Press the browser Back button. 3. Paste a deep link such as `/referrals` | Returned to the login page both times. No cached page content is visible | |
| AT-08 | Deactivated account loses access immediately | `A-VIEW` signed in in browser 2; `A-ADMIN` in browser 1 | 1. As `A-ADMIN`, deactivate `A-VIEW`. 2. In browser 2, refresh or navigate | `A-VIEW` is signed out with "This account has been deactivated. Contact your administrator." No hospital data renders | |

## B. Role gating and capabilities

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-09 | Viewer cannot raise a referral | Signed in as `A-VIEW` | 1. Look for "New referral". 2. Navigate directly to `/referrals/new` | No such action is offered; the direct URL shows an access-denied screen, not the wizard | |
| AT-10 | Viewer cannot submit readiness | Signed in as `A-VIEW` | 1. Open the readiness board. 2. Navigate directly to `/readiness/<departmentId>` | The board is readable; the submission form is refused with an access-denied screen | |
| AT-11 | Shift in-charge cannot raise a referral | Signed in as `A-SHIFT` | 1. Navigate to `/referrals/new` | Access denied. The referral **list** remains readable (they hold `referral:view`) | |
| AT-12 | Coordinator cannot reach the admin area | Signed in as `A-COORD` | 1. Navigate to `/admin` | Access denied; no admin link in the navigation | |
| AT-13 | Hospital admin cannot reach system configuration | Signed in as `A-ADMIN` | 1. Open Admin. 2. Look for scoring configuration and the emergency-type catalogue | Hospital, departments, staff and audit are available; scoring configuration and the emergency catalogue are not (`admin:system` is super-admin only) | |
| AT-14 | Super admin sees the whole network | Signed in as `SA` | 1. Open Reports and Admin. 2. Change the hospital filter | Every hospital is selectable; reports aggregate across all of them | |

## C. Readiness submission

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-15 | Submit a readiness update | Signed in as `A-SHIFT`; A has an active ICU department | 1. Open the ICU readiness form. 2. Set ICU beds 3, ventilators 2, oxygen 85%, dialysis on. 3. Submit | Success toast; the department's light turns 🟢 immediately; the submitted values are shown as the current state | |
| AT-16 | The form asks only for that department's resources | As above | 1. Open the ICU form. 2. Open the Radiology form | ICU asks about ICU beds, ventilators, oxygen and dialysis only. Radiology asks about CT, MRI, X-ray and ultrasound only | |
| AT-17 | Re-submitting within the same shift corrects, not duplicates | AT-15 done, same shift | 1. Re-open the form. 2. Change ICU beds to 1. 3. Submit. 4. Open the department's history | One entry for this shift showing 1 bed, not two entries | |
| AT-18 | The resource snapshot the scorer reads is updated | AT-15 done | 1. Open Hospital A's detail page (or query `hospital_resources`) | `icu_beds_available = 3` and `updated_at` is seconds old. The value the ranking engine reads matches what was submitted | |
| AT-19 | Blood stock is captured per group | A has a Blood Bank department; signed in as its in-charge | 1. Open the form. 2. Enter units for O-, O+, A+ and B+. 3. Submit | The per-group table on the hospital page shows exactly those counts | |
| AT-20 | The emergency department controls the diversion flag | A has an Emergency department | 1. Open its form. 2. Switch ER status to closed with reason "No ICU capacity". 3. Submit | Hospital A shows "On diversion — No ICU capacity" on its card and detail page | |

## D. Traffic-light transitions

These are the core of the readiness feature. AT-23 and AT-24 need either patience or a controlled
clock; both approaches are given.

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-21 | A fresh submission is green | AT-15 done in the current shift | 1. Open the readiness board | The department shows 🟢 with the text label "Current". Colour is never the only cue | |
| AT-22 | A department that has never reported is red | A newly created department | 1. Create a department in Admin. 2. Open the readiness board | The new department is 🔴 "Stale", with "never" as its last update | |
| AT-23 | Green turns yellow after one shift boundary | A department last updated in the previous shift | **Live:** submit late in a shift (e.g. 14:45) and re-check after 15:00. **Controlled:** as `SA`, backdate that department's most recent `readiness_updates.shift_date` / `shift_type` by one shift, then reload | The department becomes 🟡 "Overdue" the moment the shift boundary passes. The hospital roll-up follows the worst department | |
| AT-24 | Yellow turns red at the third shift | A department last updated three or more shifts ago | Backdate the last update by 3 shifts (24 hours), then reload | The department is 🔴 "Stale". At exactly 2 shifts elapsed it must still be 🟡 — check the boundary in both directions | |
| AT-25 | Hospital status is the worst of its departments | A has one 🟢, one 🟡 and one 🔴 department | 1. Open the hospital list | Hospital A shows 🔴 overall, with a breakdown of counts per status. Bringing the red department current moves the hospital to 🟡, not 🟢 | |

## E. Referral ranking

Scripted against the seed data. Before starting, record each hospital's coordinates and current
resources so the arithmetic can be checked by hand against
[SPECIFICATION.md](SPECIFICATION.md) section 4.

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-26 | Scripted ranking scenario | Set up three candidates from Hospital A: **Regional** at ~32 km, 🟢, 2 theatres, surgeon, blood bank, CT, 1 ICU bed, oxygen 80%; **Teaching** at ~68 km, 🟡, 3 theatres, surgeon, blood bank, CT, 4 ICU beds, oxygen 95%; **District** at ~12 km, 🟢, 1 theatre, **no surgeon**, blood bank, no CT, 0 ICU beds, oxygen 60% | 1. As `A-COORD`, start a new referral. 2. Emergency type: road-traffic trauma. 3. Urgency: critical. 4. View the ranking | **Regional ranks first (~85%)**, Teaching second (~71%), District listed but **ineligible**. Regional wins because it pairs a good resource fit with half the travel time; Teaching has the better resources but is 98 minutes away and loses ~12.5 points to its yellow readiness; District is nearest but cannot operate | |
| AT-27 | The missing critical resource is named | AT-26 set up | 1. Open District's card | It is marked ineligible with the reason "No resident surgeon on site" — shown, not hidden | |
| AT-28 | The staleness penalty is visible and correct | AT-26 set up | 1. Open Teaching's breakdown | The card shows 🟡, the pre-penalty weighted score and the points deducted. The deduction is 15% of the weighted score, matching the configured `yellowPenalty` | |
| AT-29 | Per-resource breakdown is complete and honest | AT-26 set up | 1. Expand any candidate's breakdown | Every scored requirement is listed with its reported value, its weight and its normalised availability. ICU with 1 of 2 saturation units reads as 50%, not 100% | |
| AT-30 | A hospital on diversion is excluded | AT-20 done for a candidate hospital | 1. Re-run the ranking | That hospital is excluded with "On diversion: No ICU capacity" and cannot be selected | |
| AT-31 | The referring hospital is never a candidate | Signed in as `A-COORD` | 1. Run any ranking from Hospital A | Hospital A never appears as an eligible option | |
| AT-32 | Urgency changes the ETA and the ranking | AT-26 set up | 1. Run the ranking at urgency *routine*, note the ETAs. 2. Re-run at *critical* | Critical uses 60 km/h and routine 40 km/h, so every ETA falls and every proximity sub-score rises. A distant hospital may overtake a near one; the change is consistent across all candidates | |

## F. Referral lifecycle

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-33 | Create a referral | Signed in as `A-COORD` | 1. Complete the wizard: emergency type, urgency, age band, sex, clinical summary. 2. Select the top-ranked hospital. 3. Confirm | Referral created with a reference of the form `FERN-YYYYMMDD-0001`, status **pending**, and the receiving hospital's contact details on screen | |
| AT-34 | No patient identifier can be entered | AT-33 in progress | 1. Inspect every field on the form | There is no name, date-of-birth, ID-number or record-number field anywhere. Age is a band, not a date. The clinical summary states "no names, dates of birth or record numbers" and is capped at 1000 characters | |
| AT-35 | The receiving hospital is notified | AT-33 done; `B-COORD` signed in elsewhere | 1. Watch B's screen without refreshing | The referral appears in B's inbox and the sidebar pending badge increments, within a few seconds | |
| AT-36 | Accept a referral | AT-33 done | 1. As `B-COORD`, open the referral. 2. Accept with a note | Status is **accepted** on both sides; the timeline records who accepted and when; a response time is recorded and appears in reports | |
| AT-37 | Decline a referral | A second pending referral to B | 1. As `B-COORD`, decline with a reason | Status **declined**; the reason is visible to A; A can immediately raise a new referral to the next-ranked hospital | |
| AT-38 | Full transfer path | AT-36 done | 1. As `A-COORD`, mark in transit. 2. As `B-COORD`, mark completed with outcome "Transferred and received" | Statuses progress pending → accepted → in_transit → completed. The timeline shows all four transitions with actor and timestamp | |
| AT-39 | Illegal transitions are rejected | A **completed** referral from AT-38, and a **declined** one from AT-37 | 1. Attempt to accept the completed referral. 2. Attempt to move the declined one to in-transit. 3. Attempt to cancel the completed one. 4. If the UI hides these, attempt the same via the API: `supabase.rpc('update_referral_status', { p_referral_id: '<id>', p_status: 'accepted' })` | Every attempt is rejected with a clear message. The stored status does not change. Terminal states are genuinely terminal, at the database and not merely in the UI | |

## G. Messaging

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-40 | Real-time two-way chat | An accepted referral; `A-COORD` and `B-COORD` signed in side by side | 1. Send a message from A. 2. Send a reply from B | Each message appears on the other screen within about a second, without refreshing, with the sender's name and time | |
| AT-41 | Chat closes when the referral does | AT-38 completed | 1. Open the completed referral. 2. Attempt to post | The composer is unavailable and a direct API insert is rejected. The history remains readable — a closed referral is a record, not a conversation | |
| AT-42 | A third hospital cannot read the thread | A referral between A and B; a coordinator at hospital C | 1. As C, request the messages for that referral by id via the API | Empty result. Not an error revealing existence — simply nothing | |

## H. Overdue readiness alerts

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-43 | Overdue departments raise an administrator alert | The scheduled job is running (DEPLOYMENT.md section 8); one of A's departments is 🔴 | 1. Wait for the next scheduled run, or execute `select public.flag_overdue_readiness();`. 2. Sign in as `A-ADMIN` and open notifications | A `readiness_overdue` notification exists for the stale department, at **critical** severity for red (warning for yellow), naming the department and how many shifts it is behind. The function returns the number created | |
| AT-44 | Alerts do not repeat every run | AT-43 done, department still red | 1. Run the function twice more. 2. Re-check notifications | No duplicate notification for the same department and staleness state. A chronically red department does not generate an alert every 30 minutes | |

## I. RLS and data isolation

**AT-45 is the single most important test in this suite.** It must be run against the API, not just
the UI: a UI that merely hides a row is not access control.

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-45 | **Hospital A cannot read Hospital B's referrals** | A referral exists between B and a third hospital C, with no involvement from A. Record its id | 1. Sign in as `A-COORD`. 2. Open the browser console and run `await supabase.from('referrals').select('*').eq('id','<B-C referral id>')`. 3. Also run `await supabase.from('referrals').select('*')` and inspect every row | Step 2 returns an **empty array with no error**. Step 3 returns only referrals where Hospital A is the requesting or the receiving party — the B–C referral is absent. Repeat in reverse (B querying an A-only referral) | |
| AT-46 | Messages are invisible to non-participants | AT-45 set up | 1. As `A-COORD`, query `messages` filtered to the B–C referral id | Empty result | |
| AT-47 | Notifications are private to their addressee | Notifications exist for several users | 1. As `A-COORD`, query `notifications` with no filter | Only rows addressed to that user are returned. `A-COORD` cannot see `A-ADMIN`'s alerts even at the same hospital | |
| AT-48 | Nobody can promote themselves | Signed in as `A-COORD` | 1. Run `await supabase.from('profiles').update({ role: 'super_admin' }).eq('id','<own id>')`. 2. Also try setting `hospital_id` to Hospital B | Both rejected — "You do not have permission to do that." The stored role and hospital are unchanged. Verify in the database, not just in the response | |
| AT-49 | A hospital admin cannot reach into another hospital | Signed in as `A-ADMIN` | 1. Attempt to update one of Hospital B's departments by id. 2. Attempt to change a Hospital B user's role | Both rejected. Admin rights are scoped to the admin's own hospital | |

## J. Printable referral form

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-50 | The form prints correctly | An accepted referral | 1. Open the referral. 2. Choose "Print referral form". 3. Open the browser print preview | Renders outside the app chrome — no sidebar, no navigation. Fits A4 without clipping. Shows the reference number, both hospitals with contact numbers, emergency type, urgency, age band, sex, clinical summary, required resources, requested time and status | |
| AT-51 | The printed form carries no patient identifier | AT-50 open | 1. Read every field on the printed page | Only the generated `PT-` reference, the age band and the sex. No name, no date of birth, no record number anywhere | |

## K. Reports and compliance

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-52 | Referral analytics are accurate | At least 10 referrals across several statuses | 1. Open Reports → Referrals. 2. Compare the totals against a manual count of the referral list for the same window | Totals, per-status and per-urgency counts match exactly. Acceptance rate = accepted ÷ responded. Both mean and median response times are shown | |
| AT-53 | Date and hospital filters work | As above | 1. Narrow the range to a single day. 2. As `SA`, change the hospital filter | Numbers change consistently and charts redraw. A non-super-admin sees only their own hospital and cannot select another | |
| AT-54 | Compliance report matches the board | Departments in a known mix of states over the last 7 days | 1. Open Reports → Compliance | Expected updates = 21 per department (7 days × 3 shifts). Actual updates and missed shifts match the `readiness_updates` history. Compliance rate is consistent with the traffic lights on the readiness board | |
| AT-55 | CSV export is safe and correct | Any populated report | 1. Export to CSV. 2. Open it in Excel or Google Sheets. 3. Check a hospital deliberately renamed to begin with `=` | Columns and totals match the on-screen table. A cell beginning `=`, `+`, `-` or `@` is prefixed with an apostrophe and **does not execute**. The export writes a `report.export` audit row | |

## L. Backup and restore

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-56 | Restore drill | A `pg_dump` taken per DEPLOYMENT.md section 9.2; an empty scratch Supabase project | 1. Restore the dump into the scratch project. 2. Point a local `npm run dev` at it. 3. Sign in and open the readiness board and a referral | Restore completes without error; user accounts, hospitals, readiness history and referrals are all present; the app functions against the restored database. Record the elapsed time — this is the measured RTO | |

## M. Performance

Measure on a mid-range Android phone or Chrome DevTools' "Fast 3G / 4G" throttling, not on a
developer laptop over office wifi. Targets are from [SPECIFICATION.md](SPECIFICATION.md) section 13.

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-57 | Initial load | Production build; cold cache; 4G throttling | 1. Load the app URL. 2. Read the Lighthouse / Performance panel | First contentful paint < 1.5 s; time to interactive < 3.0 s. The charting bundle is **not** requested on the login or readiness routes — confirm in the Network panel | |
| AT-58 | Readiness board and candidate ranking | ≥ 20 departments; ≥ 50 hospitals in range | 1. Open the readiness board and time it. 2. Run a referral ranking and time it | Board renders in < 1.0 s; ranking completes end to end in < 2.0 s | |
| AT-59 | Referral list at volume | ≥ 500 referrals for the hospital | 1. Open the referral list. 2. Apply status and date filters | First page renders in < 1.5 s; filters respond without a visible stall | |
| AT-60 | Badges do not fetch rows | Signed in, any screen | 1. Watch the Network panel for 60 seconds | The pending-referral and unread-notification requests poll about every 30 s, return a count header and **zero row data**, and stop polling when the tab is backgrounded | |

## N. Mobile, responsive and accessibility

| ID | Title | Preconditions | Steps | Expected result | Result |
| --- | --- | --- | --- | --- | :---: |
| AT-61 | Readiness submission on a phone | A real phone at 375 px width, as `A-SHIFT` | 1. Sign in. 2. Complete and submit a readiness update | Every control is reachable and tappable one-handed; no horizontal page scroll; the submit button is not hidden behind the keyboard | |
| AT-62 | Wide content scrolls without breaking the page | Reports and referral list on a 375 px viewport | 1. Open each. 2. Attempt to scroll the page sideways | Wide tables scroll **inside their own container**; the page body itself never scrolls horizontally | |
| AT-63 | Keyboard and screen reader | Desktop, keyboard only, plus NVDA or VoiceOver | 1. Tab through login, the readiness form and the referral wizard. 2. Open and close a modal with the keyboard | Focus order is logical and the focus ring is always visible; every input announces its label, hint and error; icon-only buttons announce a name; modals trap focus and close on Escape | |
| AT-64 | Traffic light is not conveyed by colour alone | Any readiness board; a colour-blindness simulator or greyscale mode | 1. View the board in greyscale | Every status is still unambiguous from its text label ("Current" / "Overdue" / "Stale") and its position. Dark mode is checked at the same time and every surface remains legible | |

---

## Defect log

| # | Test ID | Severity | Description | Raised | Status | Resolved |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

Severity: **Critical** — data loss, a security or isolation failure, or a blocked clinical workflow.
**Major** — a contracted feature does not work as specified. **Minor** — cosmetic, or a workaround
exists.

---

## Summary

| Area | Cases | Passed | Failed | N/A |
| --- | :---: | :---: | :---: | :---: |
| A. Authentication and session | 8 | | | |
| B. Role gating and capabilities | 6 | | | |
| C. Readiness submission | 6 | | | |
| D. Traffic-light transitions | 5 | | | |
| E. Referral ranking | 7 | | | |
| F. Referral lifecycle | 7 | | | |
| G. Messaging | 3 | | | |
| H. Overdue readiness alerts | 2 | | | |
| I. RLS and data isolation | 5 | | | |
| J. Printable referral form | 2 | | | |
| K. Reports and compliance | 4 | | | |
| L. Backup and restore | 1 | | | |
| M. Performance | 4 | | | |
| N. Mobile, responsive and accessibility | 4 | | | |
| **Total** | **64** | | | |

---

## Acceptance criteria

The system is accepted when:

1. Every **Critical** and **Major** defect is resolved and its test re-run and passed.
2. **AT-45** (cross-hospital data isolation) passes without qualification. There is no acceptable
   waiver for this case.
3. **AT-34** and **AT-51** pass: no patient identifier can be entered or printed.
4. **AT-56** (restore drill) has been completed and the elapsed time recorded.
5. All remaining cases pass, or carry a waiver signed by the client in the table below.
6. CI is green on `main`: typecheck, unit tests and production build.

### Waivers

| Test ID | Reason for waiver | Agreed by (client) | Date |
| --- | --- | --- | --- |
| | | | |
| | | | |

---

## Sign-off

By signing below, the parties confirm that the acceptance tests recorded in this document were
executed against the deployed system on the dates shown, and that the results above are a true
record of what was observed.

**Test execution**

| | Client representative | Developer |
| --- | --- | --- |
| Name | | |
| Role | | |
| Signature | | |
| Date | | |

**Acceptance**

| | Client representative | Developer |
| --- | --- | --- |
| Name | | |
| Role | | |
| Signature | | |
| Date | | |
| Release accepted | ☐ Accepted ☐ Accepted with waivers ☐ Rejected | |

**Environment tested**

| | |
| --- | --- |
| Application URL | |
| Release / commit | |
| Supabase project ref | |
| Test window | |
