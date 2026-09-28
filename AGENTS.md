# Voice Life Manager - Architecture and Engineering Rules

## Authority and scope

- Primary product source: [Korean blueprint v5](docs/Voice_Life_Manager_Product_Blueprint_v5_KR.pdf).
- Secondary reference: [English blueprint v5](docs/Voice_Life_Manager_Product_Blueprint_v5_EN.pdf).
- The approved product decisions below resolve blueprint ambiguities and take precedence over conflicting examples or translations. Otherwise, follow the Korean blueprint over English.
- Preserve React Native, Expo, TypeScript, Expo Router, and SQLite with Android and iOS compatibility.
- These rules define future implementation boundaries, not permission to implement features. Implement only the explicitly requested task and stop at its scope.

## Approved product decisions

### 1. NOTE
- Note is part of the MVP domain model.
- It acts as a fallback for information that does not clearly belong to Transaction, Task, or Event.
- Do not create a dedicated Notes tab in the initial MVP.

### 2. AMBIGUOUS TIME
- Never silently interpret "7시" as 19:00.
- Ask for AM/PM unless context explicitly resolves it, such as "저녁 7시".
- Fuzzy time such as "저녁쯤" may be stored as fuzzy metadata when no precise reminder is required.
- If a reminder calculation requires an exact time, ask for the exact time.

### 3. EVENT LIFECYCLE
- Event statuses must distinguish at least:
  upcoming
  past
  completed
  cancelled
- Passing the event time changes it to past, not automatically completed.

### 4. MONEY
- Initial default currency is KRW.
- Store amount as a positive integer.
- EXPENSE / INCOME determines direction.
- Do not encode expenses as negative database amounts.
- Keep a currency_code field so future currencies are possible.

### 5. TIME STORAGE
- Persist absolute timestamps in UTC ISO format.
- Display dates/times in the user's local timezone.
- Keep timezone information where necessary for scheduled events/reminders.

### 6. COMPOUND COMMANDS
- ActionProposal supports multiple actions.
- Each action has its own validation and execution state.
- Independent valid actions may execute even if another action requires clarification.
- Dependent actions must wait for their dependency.
- The UI must clearly show which actions succeeded, are pending clarification, or failed.

Example:
"점심 8천원 썼고 내일 민수 만나. 한 시간 전에 알려줘."

The expense may save immediately.
The Event remains pending because time is missing.
The Reminder remains pending because it depends on the Event time.

### 7. UNDO
- Every reversible automatic mutation must create enough evidence to reverse it.
- Show immediate UI Undo after automatic saves.
- Conversation commands such as "방금 거 취소해줘" may target the most recent reversible action.
- Destructive operations outside the safe Undo context require confirmation.

### 8. DUPLICATES / IDEMPOTENCY
- Build idempotency support into Action execution.
- Detect likely rapid duplicate submissions.
- Do not silently discard legitimate repeated transactions.
- Duplicate detection should produce a reviewable result when uncertain.

### 9. CONVERSATION CONTEXT
- MVP context is short-lived.
- Track recent actions and unresolved proposals during the active session.
- Do not persist long-term conversational memory across app restarts in MVP.
- If multiple recent targets match, ask the user instead of guessing.

### 10. OFFLINE
- Local CRUD and local history must work offline.
- Do not silently execute AI-dependent actions later without the user's knowledge.
- If AI processing is unavailable, preserve the text as a pending draft.
- The user can retry processing when connectivity returns.
- Never defer a destructive action for later automatic execution.

### 11. RAW AUDIO
- Raw audio storage is OFF by default.
- Temporary audio may exist only while speech recognition is processing.
- Delete temporary audio after STT finishes or fails.
- Do not retain raw audio merely for debugging.

### 12. REMINDER STATES
Use at least:
- requested
- permission_blocked
- scheduled
- cancelled

Do not claim a reminder was delivered unless the platform provides reliable evidence.
Store both the resolved fire time and enough relationship data to recalculate relative reminders when their Event changes.

### 13. AI
- Do not choose or integrate an AI provider yet.
- Create an AI Gateway abstraction later.
- Local parsing and AI parsing must eventually produce the same ActionProposal contract.
- API keys must never be embedded directly in the mobile client for production.

### 14. PRIVACY
- Core personal data is local-first.
- raw_input and ActionLog remain local in the MVP.
- Send only the minimum required context to an AI service when AI is introduced.
- Raw audio is not sent unless required for the selected STT implementation and the user has given the required permissions.

### 15. ARCHITECTURE
Enforce this dependency direction:

UI / Features
↓
Application
↓
Domain
↓
Repository interfaces

Adapters and database implementations implement interfaces from inner layers.

Platform-specific code must live behind adapters.

AI must never directly mutate SQLite.

All mutations flow through:

ActionProposal
→ Validator
→ Executor
→ Repository
→ SQLite
→ ActionLog

### 16. DATABASE
- Use migrations for every schema change.
- Use stable UUID-style IDs.
- Use created_at and updated_at on core entities.
- Use soft deletion where recovery/history matters.
- Add indexes only when justified by query patterns.
- Do not over-engineer cloud-sync fields before Phase 2.

### 17. FAILURE
Never report success when persistence, notification scheduling, or another required operation failed.

Preserve enough information for recovery and clearly expose partial success.

### 18. DEVELOPMENT PROCESS
For every task:
- inspect existing relevant code first
- modify only the requested scope
- keep Android and iOS compatibility
- run TypeScript checks
- run relevant tests
- report changed files
- report tests performed
- report known limitations
- stop after the requested scope

### 19. DO NOT BUILD YET
Do not implement:
- AI provider integration
- cloud sync
- habits
- recurring schedules
- calendar integrations
- advanced natural-language search
- weekly AI reports
- personalization engine

### 20. TARGET PROJECT STRUCTURE

```text
src/
  domain/
    transaction/
    task/
    event/
    note/
    reminder/
    action/

  application/
    proposals/
    validator/
    executor/
    undo/

  database/
    migrations/
    repositories/

  adapters/
    speech/
    notifications/
    ai/

  features/
    home/
    capture/
    money/
    tasks/
    history/
    settings/

  components/
  hooks/
  utils/
  types/
```


## Architecture enforcement and routing

- Keep `src/app/` as Expo Router route/layout entry points alongside the target structure above. Route components compose feature screens; business rules and persistence must not live in route files.
- `src/features/` and shared UI call application use cases. They must not import concrete database repositories or issue SQL directly.
- Application orchestration depends on domain contracts and inner-layer interfaces, not concrete platform or database implementations.
- Place repository interfaces with the relevant domain under `src/domain/`; implement them in `src/database/repositories/`. Domain code must not depend on React, Expo, SQLite, application, features, or adapters.
- Speech, notification, and AI adapters implement contracts owned by the inner layers. Wire concrete implementations in a composition boundary; do not couple domain rules to platform APIs.
- All user-facing mutations, whether manual, locally parsed, AI proposed, or Undo, use the approved proposal/validation/execution path. Migration SQL is infrastructure work, not a bypass for product mutations.
- Execution evidence must identify per-action outcomes and retain enough reversal data for safe Undo. The pipeline's ActionLog step is required evidence, not permission to report success before required persistence succeeds.
- The folder tree is a target structure. Create directories only when needed by an authorized implementation task; do not create empty scaffolding or move existing starter code merely to match it.
- The production API, scheduling, and storage contracts must be decided explicitly when their implementation is requested; do not silently invent unresolved product policies.

## Expo and repository engineering guidance

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run TypeScript checks and relevant tests for every task. Run configured lint checks for code changes without automatic fixes unless fixes are in scope. If lint or tests are not configured, report that limitation; do not install dependencies or generate configuration during a documentation-only task. Do not claim a skipped check passed.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
