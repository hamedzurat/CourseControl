---
trigger: always_on
---

# Code Commenting Standards

## Goal

Ensure comments add value by explaining the _intent_ and _reasons_ behind code using simple, direct English.

## Constraints

- **NEVER** use emojis in comments (e.g., avoid 🚀, ⚠️, 🐛).
- **NEVER** use mdashes (—); use standard hyphens (-) or colons (:) instead.
- **NEVER** use complex, flowery, or "AI-generated" vocabulary (e.g., avoid "delve," "tapestry," "leverage," "paramount," "underscore"). Keep it conversational but professional.
- **NEVER** write comments that simply translate code into English (e.g., `// loop through items` before a `for` loop).
- **NEVER** leave commented-out code snippets. Delete them.

## Instructions

### 1. The "Why", Not the "What"

- Comments must explain **business logic**, **complex algorithms**, or **workarounds**.
- **Bad:** `// Set user to active`
- **Good:** `// Activating user immediately to prevent race condition in the auth flow.`

### 2. Public Interfaces (TSDoc)

- All exported functions, classes, and interfaces **MUST** use TSDoc (`/** ... */`) format.
- Include `@param`, `@returns`, and `@throws` tags where applicable.
- **Example:**

```typescript
  /**
   * Attempts to reserve a seat in the section.
   * @param studentId - The unique ID of the requesting student.
   * @returns A promise resolving to the reservation status.
   * @throws {SeatReservationError} If the section is locked or invalid.
   */
  export async function reserveSeat(studentId: string): Promise<Result> { ... }

```

### 3. TODOs and FIXMEs

- `TODO` comments must include a brief context or a GitHub issue reference.
- `FIXME` implies broken or dangerous code that needs immediate attention.
- **Format:** `// TODO: [Refactor] Extract this logic to a utility once the API stabilizes.`

### 4. Magic Numbers & Strings

- Do not comment magic numbers. Extract them into named constants and document the constant if necessary.
- **Bad:** `if (status === 2) // 2 means active`
- **Good:** `const STATUS_ACTIVE = 2; if (status === STATUS_ACTIVE) ...`

### 5. Tone & Style

- Be concise. Use short sentences.
- Avoid passive voice where possible.

## Examples

### Incorrect

```typescript
// 🚀 Iterating over the array to transformative effect — ensuring data integrity...
const list = items.map((i) => {
  // return the name
  return i.name;
});
```

### Correct

```typescript
// Map raw D1 rows to the frontend shape to avoid leaking internal IDs.
const safeItems = items.map((item) => ({
  id: item.public_id,
  name: item.display_name,
}));
```
