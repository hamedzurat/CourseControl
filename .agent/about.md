# CourseControl

## Core Mission

CourseControl is a high-performance backend system designed for an open credit-based university's section selection process while being low cost.
It is specifically engineered to handle the "thundering herd" problem where thousands of students attempt to enroll simultaneously.

### Key Principles

- **Strictly First-Come, First-Served:** Fairness is paramount. The exact millisecond of arrival at the Section Actor determines success.
- **Actor Model Architecture:** State is isolated in single-threaded actors (Durable Objects) to prevent race conditions without complex database locking on section-selection phase.
- **Consistency over Availability:** In the event of a network partition or heavy load, the system prefers to deny a request rather than allow a double-booking (Strong Consistency via SQLite in DO).
- **Zero Trust Security:** No unauthenticated user ever touches the application logic. All requests are RBAC-checked before reaching actors.
- **Pragmatic UI:** The interface never guesses. It reflects the exact state of the system (Pending, Success, Failed) rather than using optimistic updates.
- **Read-Heavy Optimization:** Static data (Section info, Faculty names) is cached aggressively (R2/KV/Local Actor Memory) to spare the transactional DBs for writes only.
