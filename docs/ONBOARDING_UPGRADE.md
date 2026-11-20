# Organisation onboarding upgrade — 17 November 2026

## Confirmed causes

- The model had no server-supplied current date in profile stages. Date warnings depended on its own clock assumptions, and source fingerprints did not invalidate a review when the calendar day changed.
- Profile schemas, prompt examples and omission reconciliation supported only nine basic fields. Expanded facts were stripped during parsing or omitted during correction; arrays of records were not treated as populated values. Nested omissions could remove policy dates, sources or individual records.
- The form exposed only basic fields, excluded insurance from source selection, replaced reviewed values wholesale with new AI output, and kept source references only in a transient result. Keeping an entire approved array also discarded new documented records.
- Provider safety blocks were reported as empty/unreadable responses. No local keyword filter discarding child safeguarding was found; a live Gemini block for the user's documents has not been established.
- Start Application previously created an empty application and navigated to the list without opening an assisted source review.

## Resulting behaviour

All structured AI calls receive the server's current Melbourne calendar date and timezone. Registration, charity registration, founding, certificate issue and insurance dates remain separate. Strict calendar checks handle full ISO dates and complete Australian month-name dates without inferring missing precision. Pure false-future event warnings and previous generated calendar findings are recomputed; source disputes remain. Profile source fingerprints include a new contract version and current Melbourne day, requiring older or overnight continuations to restart.

Extraction, independent verification, correction, saving and review now support mission/purpose, beneficiaries, service locations, history, milestones, current/historical/planned activities, separate registration facts, repeatable insurance records and other documented facts. Unknown dates, outcomes and completed work remain absent. Optional details sit in six collapsible review sections; insurance documents require explicit selection. Expanded data uses the existing `organizations.profile` JSONB column, preserving legacy keys and profiles. Approval verifies the actual returned database row; a zero-row update leaves the form available for retry.

Existing approved values survive another source review, with explicit differences to review. New distinct records are added; correction omissions are retained only as unconfirmed candidates when no source finding disputes them. Candidate source quotes and review notes are saved for inspection but excluded from downstream approved-fact contexts. Approved expanded fields remain available to grant preflight and drafting. Policy numbers and private evidence remain outside the explicit public-email whitelist and diagnostic logs.

Start Application opens/resumes its draft and runs bounded source research through the existing background-job transport. Research receives public grant facts; approved organisation facts enter a separate structured pass without web tools. It checks the retrieved source role and presents eligibility, criteria, dates, attachment requirements and unresolved project questions. Suggestions fill empty fields only on an explicit action. Complete current official guidelines/questions still require user review before drafting, and saved official source links guide retrieval/upload when research is incomplete. Existing answers and manual draft text survive saving/reopening. Prior AI research notes are excluded from project-fact contexts.

Branding follows the supplied Easy Compliance guide while retaining Simple Grants. The actual Simple AI artwork was extracted from the guide's embedded image and original transparency mask, without redrawing. Palette, local fonts, forms, navigation, login, favicon and sign-in email follow the guide. See [asset provenance](../public/BRAND_ASSETS.md).

## Validation and limits

The exact My Safe Circle safeguarding passage is a regression fixture. Controlled model responses verify that its purpose, focus areas and stated activities survive all three stages without invented founding dates, completed programs, outcomes or locations. Tests also cover nested nulls, omission recovery, disputed facts, stale date warnings, date rollover, reviewed-value retention, insurance opt-in, zero-row saves, expanded saved-profile browser round trips, public-email privacy and downstream fact reuse.

Validation completed on 17 November 2026:

| Check                                 | Result                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `npm test`                            | 330 tests across 27 files passed                        |
| `npm run test:browser -- --workers=2` | 87 browser tests passed                                 |
| `npm run test:db`                     | All six disposable PostgreSQL scenarios passed          |
| `npm run build`                       | TypeScript and Vite production build passed             |
| `npm run db:check`                    | Installer and upgrade match canonical migrations        |
| `npm run test:ai:runtime -- --quick`  | Packaged Netlify handlers and built browser flow passed |

The runtime test packages the actual Netlify handlers and serves the built application with isolated Auth/PostgREST/Storage/Gemini HTTP fixtures. It does not use live model reasoning. Desktop and 390px mobile branding layouts were also inspected. An older browser mock needed updating to return the actual saved row after the new persistence check; the full suite then passed.

Read-only hosted checks located My Safe Circle's six document records and confirmed the profile column is JSONB, organisation RLS is enabled and the document bucket is private. Their cached extracted text is empty; the private document bytes were not inspected. No production profile was rewritten or approved. Live Gemini reasoning on those files, live official-source retrieval and a production browser session remain unverified. No real email or digest delivery was run.

## Rollout

No SQL migration, new table, storage policy, shared Auth change or new environment variable is required. Application source research consumes the existing `draft` quota category. Deploy frontend and functions together so client/server schemas and fingerprint versions agree. Existing `ai-worker-background`, `/api/ai-jobs` and private job expiry/ownership flow remain in use. Existing in-progress source checks must be restarted after the update; approved profiles remain available.
