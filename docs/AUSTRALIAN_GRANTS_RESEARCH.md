# Simple Grant: Australian grants product requirements

Research prepared 10 November 2026 (Australia/Melbourne).

## Evidence and verification status

This is a product-design brief, not legal, tax or audit advice. The official primary sources listed below were identified, but the current environment explicitly denied their HTTP requests with proxy `403 Forbidden`. Their current contents and any November 2026 changes could not be independently verified during this session. The links are reference starting points, not quotations from pages that were read. Recheck the published guidance and the actual grant opportunity guidelines before treating a requirement as current or mandatory.

The most important design conclusion is reliable without pretending every funder uses the same process: **the individual opportunity's published guidelines, application form and executed grant agreement determine the application and reporting obligations.** The system needs to model those source documents and their versions, not use one universal Australian application checklist.

## How the lifecycle should work

1. **Build a verified organisation profile.** Identify the actual legal applicant, ABN, legal structure, charity registration where relevant, DGR endorsement where relevant, operating area and purposes. One login can manage several legal entities; evidence and applications must remain attached to the correct entity.
2. **Find opportunities.** Search Commonwealth, state, territory, council and philanthropic sources. GrantConnect is a Commonwealth discovery source, not a complete directory of every Australian grant. An opportunity may be advertised on one site and submitted on a separate funder's portal.
3. **Check eligibility before drafting.** Extract the applicant types, region, target beneficiaries, eligible activity dates, financial limits, exclusions, matched funding, auspice arrangements, and required registration or insurance. Show `eligible`, `ineligible` or `needs confirmation`, with the source and reason. AI confidence is not evidence of eligibility.
4. **Prepare the application.** Obtain the current guidelines and actual questions with word limits, budget template, declarations and required attachments. Draft against the assessment criteria using approved organisation facts and project information. Ask for missing facts; do not invent evidence, partnerships, results or costs.
5. **Review and approve.** Let a coordinator draft, a treasurer check the finances, and an authorised person approve declarations and submission. Retain the approved version, source documents and approval history.
6. **Submit using the funder's prescribed method.** For the first version, export the application and direct the user to the official portal. Require the user to record the submission receipt/reference and time. Sending a draft or clicking an external link does not mean it was submitted. Third-party portals do not all offer a submission API.
7. **Record the outcome and agreement.** Capture the award letter, executed agreement, payment schedule, conditions, approved budget, milestones and reporting deadlines. Awarded and paid are different states.
8. **Deliver and monitor.** Track activities, outcomes, invoices, expense eligibility, budget categories, co-contributions, milestone progress and funder correspondence. Requests to change scope, timing or budget need a variation process and the funder's approval where required.
9. **Report and acquit.** Prepare the required progress and final reports, evidence of outcomes, financial acquittal and any audit/review certificate specified by the agreement. Record acceptance by the funder, return of unspent funds where required, and retention requirements before closing the project.

## Organisation records and document checklist

Make these configurable by legal structure, funder, program and application stage. A missing document should block a draft only when it is actually critical to the requested action; absent published guidelines or actual application questions are critical to a compliant application draft.

| Record or document                                                         | Why it matters                                                                                      | Product behaviour                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Legal name, trading name, ABN and legal structure                          | Establishes the applicant and whether it is an eligible entity                                      | Show source and date; validate ABN format/checksum but do not confuse a valid number with a verified register record         |
| Incorporation/registration certificate and constitution or governing rules | Evidence of legal status and purposes                                                               | Store verified copies and distinguish an incorporated association, company, trust, unincorporated group and auspiced project |
| ACNC registration                                                          | Some programs require charity status                                                                | Record registered name and check status at application time; ACNC registration is not universal grant eligibility            |
| DGR endorsement and relevant category                                      | Some philanthropic or tax-related grants require it                                                 | Keep separate from charity registration and income-tax exemption; never assume every charity is a DGR                        |
| Financial statements and annual reports                                    | Supports viability and confirms financial position                                                  | Capture financial year, approval status and whether statements are audited, reviewed or unaudited                            |
| Audit/review report, if applicable                                         | May be required by law, the regulator, the constitution or the funder                               | Request the existing professional report; Simple Grant does not perform or certify an audit                                  |
| Insurance certificates of currency                                         | Public liability, professional indemnity, workers compensation or other cover may be required       | Record cover type, amount, insured legal entity, start/expiry dates; warn on expired evidence                                |
| Policies and clearances                                                    | Child safety, safeguarding, working-with-children, privacy, conflicts and other sector requirements | Ask only where relevant; restrict access to sensitive personal records rather than distributing them by email                |
| Previous project results and organisational history                        | Supports capability and evidence of delivery                                                        | Reuse approved facts with their evidence, date and geographic relevance                                                      |
| Authorised contacts and signatories                                        | Clarifies who can approve legal declarations or sign agreements                                     | Separate drafting permission from approval and owner/admin permission                                                        |
| Auspice agreement, where used                                              | The legal applicant and delivery organisation may differ                                            | Represent both parties, their responsibilities, fees and required approvals                                                  |
| Bank verification documents                                                | Some funders require bank details for payment                                                       | Treat as restricted data; never put bank numbers into email replies, AI prompts or public profile fields                     |

### Financial statements and audited financial statements are different requirements

Do not make “audited financial statements uploaded” mandatory for every charity. Under the established ACNC reporting framework, the commonly used annual-revenue categories are small (less than $500,000), medium ($500,000 to less than $3 million), and large ($3 million or more). Medium charities ordinarily need reviewed or audited annual financial reports; large charities ordinarily need audited annual financial reports; small charities generally do not submit an annual financial report to the ACNC, subject to exceptions and other obligations. These thresholds and exceptions need current verification against the ACNC sources below before being encoded as an automatic legal rule.

Other regulators, constitutions, grant guidelines, grant agreements or particular circumstances can require additional reporting regardless of that ACNC category. An ACNC reporting concession is not a funder's waiver. Record **why** a report is requested and which authority/document imposes it. Allow a human reviewer to approve a legitimate `not required` outcome with evidence.

## Per-opportunity and per-application requirements

The grant record should contain:

- Funder, program, round/version, official source URL, issuing body and source retrieval date.
- Opening and closing timestamp **with its original timezone** and whether the round is ongoing, by invitation or fixed deadline. Store an unambiguous instant for reminders. Australian deadlines are not all Melbourne time; daylight saving differs by state.
- Minimum/maximum grant amount, GST treatment if specified, co-contribution requirements, eligible expenditure period, exclusions and whether spending before approval is ineligible.
- Eligible entity types, region, beneficiaries, required registrations, activities, partnerships and explicit disqualifiers. Treat unknowns as questions, not matches.
- Guidelines, application form/questions, criteria, scoring/weightings when published, word/character limits, attachment formats and maximum sizes.
- Required budget and financial templates, quotations, business/project plan, support letters, landowner approvals or permits where applicable.
- Submission portal/method, account requirements, contact for questions, outcome timing and acknowledgement requirements.
- Related grant funding and declarations to flag potential duplicate funding of the same cost.

The application record should preserve drafts, revisions, sources for factual assertions, unresolved questions, attachments, human approvals and a submission receipt. Include `drafting`, `needs information`, `ready for review`, `approved`, `submitted`, `successful`, `unsuccessful` and `withdrawn` states. A successful application becomes a funded project only when that status is confirmed; it should not vanish from application history.

## Features to add beyond the initial idea

| Priority   | Capability                                                               | Reason                                                                                              |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Foundation | Multi-organisation membership and server-enforced access controls        | A charity's documents, drafts and invoices must never leak into another organisation                |
| Foundation | Document versions, categories, expiry dates and source citations         | Old insurance and superseded guidelines can invalidate an otherwise good application                |
| Foundation | Three-pass organisation extraction and human approval                    | Extract, compare to source, correct; show unresolved conflicts and evidence before committing facts |
| Foundation | Evidence-based eligibility and missing-information checklist             | Avoid spending volunteer time on an ineligible or incomplete application                            |
| Foundation | Human approval and submission receipt                                    | The applicant must approve declarations; a generated application is not a submission                |
| Foundation | Budget with GST, eligible/ineligible categories and co-funding           | Requested amount is not the same as total project cost; grant conditions vary                       |
| Foundation | Milestones, deliverables and reporting deadlines                         | The work continues after the award; missed reporting affects funding                                |
| Foundation | Inbox triage and sender verification                                     | An organisation address by itself does not authorise someone to access that organisation's data     |
| Next       | Duplicate invoice detection, invoice-to-grant allocation and corrections | Prevent double-counting and attaching an expense to the wrong funded project                        |
| Next       | Variations, payment tracking and unspent funds                           | Keep approved changes and actual cash movements separate from AI summaries                          |
| Next       | Outcome indicators and evidence collection                               | Final reports need evidence of delivery and benefit, not just a narrative                           |
| Next       | Review roles, approval history and activity audit trail                  | Support volunteer handover and accountable board oversight                                          |
| Next       | Exportable grant pack, financial acquittal and organisation data         | Let the user submit externally and retain accessible records                                        |
| Later      | Accounting integration and bank reconciliation                           | Reconcile actual transactions while avoiding unnecessary sensitive-data ingestion                   |
| Later      | Provider-specific submission integrations                                | Build only where the funder explicitly supports and permits the integration                         |

## AI behaviour: make errors visible and correctable

For organisation onboarding, use the requested three-pass flow:

1. **Extract** only facts supported by the supplied documents and pasted history, with document/page references where available. Missing values stay empty.
2. **Verify** each extracted field against its source; identify conflicts, stale dates, uncertain legal names and unsupported claims. Do not treat a second model call as independent proof.
3. **Correct** only supported errors; retain unresolved discrepancies as questions. Present the proposed profile and the evidence to a human for approval.

Keep the original documents and each extraction/review/correction result. A subsequent upload proposes changes; it must not silently overwrite an approved legal identity or bank detail.

For discovery, require a direct official source URL and retrieval date, distinguish a potentially suitable grant from a confirmed eligible one, and show whether the closing date was actually verified. Do not label an AI web search as complete coverage of all grants in Australia.

For drafting, the model needs the current program guidelines and actual questions/limits. If they cannot be obtained online, ask the user to upload them. A summary alone is insufficient for a compliant final draft. Project-specific facts such as participant numbers, staff capacity, cost estimates and measurable outcomes require user evidence or explicit confirmation. Preserve `needs information` instead of filling the gap with plausible text.

For reporting, the model can organise recorded evidence and draft narratives. It must not certify that funds were spent appropriately, that an audit occurred, or that a funder accepted an acquittal without corresponding records.

## Email workflow and privacy

The user has mentioned both `@thesimpleai.com` and an example `@simpleai.com.au`. Ownership and intended use of the second domain have not been established. Choose one verified sending/receiving domain or a dedicated subdomain during deployment; do not invent working email accounts or change an existing production domain's MX records casually.

A safe implementation should:

- Verify the inbound provider's webhook signature and handle retries idempotently.
- Match the exact recipient alias to an organisation; use a unique, unguessable or collision-checked alias rather than trusting a display name.
- Quarantine unknown senders and ambiguous grant associations. A From address alone is not strong authentication; sender authentication results, approved membership, portal confirmation and risk-appropriate checks matter.
- Scan attachments, restrict size and allowed types, and retain the original email/message reference. Treat forwarded messages and documents as untrusted content, not instructions to disclose or change data.
- Distinguish `invoice`, `progress evidence`, `funder correspondence`, `question` and `unclassified`. Let the user correct the classification and target grant before financial records are finalised.
- Answer email questions from an explicit allowlist of public information, such as published grant details and an organisation's already-public name/ABN. Do not allow a free-form model to choose its own private context.
- Never include bank details, tax file numbers, credentials, health records, private financial statements or private attachments in ordinary email replies. Financial statements may contain sensitive information even when a different version is public.
- Use an authenticated portal link for private status and documents. Keep redirect targets restricted to the application's own routes; no sensitive data or bearer access token belongs in the URL.
- Provide unsubscribe/pause controls for discovery digests. Honour the chosen weekly, monthly or never preference; do not treat service notices and optional grant discovery messages as identical.
- Check applicable Privacy Act obligations, overseas AI/data processing disclosures, retention, deletion/export, access logging and incident response. Avoid promising that every small charity is exempt from privacy obligations or that an Australian database region alone guarantees all processing stays in Australia.

## An accessible interface for volunteer directors

Use a small number of clear destinations: **Organisation**, **Find grants**, **Applications**, **Funded projects**, and **Inbox**. The dashboard should answer: “What needs my decision?”, “What closes next?” and “What is due next?”

Use large readable type, generous controls, strong text contrast and visible keyboard focus. Meet WCAG 2.2 AA as the implementation target. Do not communicate state through colour alone. Use ordinary labels such as “Upload documents”, “Review these details”, “Save draft” and “Approve profile”. Show one primary next action at a time.

Prefer document upload or paste over a long blank form, but always allow corrections. Accept an upload in stages, show progress and file errors clearly, and preserve work if the user leaves. Preview what AI found with the original source accessible beside it. Explain the next action and the consequence of approval in plain language.

Email should be a convenient intake channel, while the portal remains the place for private information, approvals and uncertain classifications. A weekly/monthly summary should show a few relevant opportunities with the closing date and a clear “View grant” button that returns the user to that grant after login.

## Primary sources to verify before launch

All sources below were blocked in this environment; none is represented as live-verified.

| Source                                            | Official entry point                                                                                                                  | What to verify                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GrantConnect                                      | https://www.grants.gov.au/                                                                                                            | Commonwealth opportunity documents, closing time, current guidelines and award information; do not assume all Australian grants are listed |
| business.gov.au grants and programs               | https://business.gov.au/grants-and-programs                                                                                           | Discovery coverage, eligibility and links to the actual application process                                                                |
| Commonwealth Grants Rules and Principles 2024     | https://www.finance.gov.au/government/commonwealth-grants/commonwealth-grants-rules-and-principles-2024                               | Current framework, amendments and guidance; these are not a substitute for each opportunity's conditions                                   |
| Community Grants Hub                              | https://www.communitygrants.gov.au/                                                                                                   | Applicant support, agreements, grant administration, reporting and acquittal guidance                                                      |
| ACNC                                              | https://www.acnc.gov.au/                                                                                                              | Current charity-size thresholds, financial reporting, audit/review requirements and exceptions                                             |
| ACNC charity size                                 | https://www.acnc.gov.au/for-charities/manage-your-charity/charity-size                                                                | Current revenue thresholds and reporting categories                                                                                        |
| ACNC review and audit                             | https://www.acnc.gov.au/for-charities/manage-your-charity/obligations-acnc/reporting-annually-acnc/review-and-audit-financial-reports | Review versus audit, required report types and qualified reviewer/auditor requirements                                                     |
| Australian Taxation Office                        | https://www.ato.gov.au/                                                                                                               | DGR endorsement, not-for-profit tax obligations and GST treatment relevant to the applicant and grant                                      |
| Office of the Australian Information Commissioner | https://www.oaic.gov.au/privacy                                                                                                       | Applicable privacy obligations, APP guidance, security, disclosure and overseas processing                                                 |
| Australian Cyber Security Centre                  | https://www.cyber.gov.au/                                                                                                             | Account security, phishing, email compromise and secure handling of financial information                                                  |
| W3C WCAG 2.2                                      | https://www.w3.org/TR/WCAG22/                                                                                                         | Accessibility criteria and testing requirements                                                                                            |

Network additions needed for fresh verification include the exact source hosts above: `www.grants.gov.au`, `business.gov.au`, `www.finance.gov.au`, `www.communitygrants.gov.au`, `www.acnc.gov.au`, `www.ato.gov.au`, `www.oaic.gov.au`, `www.cyber.gov.au`, and `www.w3.org`, plus any verified redirect destinations. No network-policy changes were made by the research task.

## Practical launch boundary

A first release should help a user collect evidence, review organisation facts, assess opportunities, prepare applications and track funded work. It should clearly distinguish demo/sample data, AI suggestions, approved facts, submitted applications, recorded expenses and accepted reports. Do not market live grant coverage, automated submission, reliable invoice allocation, legal compliance, audit certification or fully autonomous grant management until those capabilities have been implemented and validated with real service credentials and a representative Australian funder workflow.
