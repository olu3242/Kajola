# Output Template Reference

Use this structure for every platform architecture package. Every section must be present.

---

# [Product Name] — Full System Architecture Package

**Version**: 1.0  
**Date**: [date]  
**Stack**: [confirmed tech stack]  
**Market**: [target region]  
**Tenant Model**: [individual / business / cooperative / mixed]

---

## 1. PRD — Product Requirements Document

### Vision
[One sentence: what this platform does and for whom]

### Problem
[Specific pain being solved, with market context]

### Users & Personas
| Role | Description | Primary Actions |
|------|-------------|-----------------|
| [role] | [who they are] | [top 3 things they do] |

### P0 Features (MVP — must ship)
- [ ] [Feature with 1-line description]

### P1 Features (Launch-ready)
- [ ] [Feature]

### P2 Features (Post-launch)
- [ ] [Feature]

### Non-Functional Requirements
| Requirement | Target |
|-------------|--------|
| Page load (mobile, 3G) | < 3s |
| Concurrent users (MVP) | 1,000 |
| Uptime SLA | 99.5% |
| Data residency | [region] |

### Out of Scope (MVP)
- [explicit exclusion]

---

## 2. System Architecture

```
[ASCII architecture diagram — minimum 20 lines, showing all layers]
```

**Key design decisions:**
1. [Decision + rationale]
2. [Decision + rationale]

---

## 3. Database Schema

### Enums
```sql
[All CREATE TYPE statements]
```

### Helper Functions
```sql
[RLS helper functions]
```

### Core Tables
```sql
[Full CREATE TABLE for every table — no abbreviation]
```

### Indexes
```sql
[All CREATE INDEX statements]
```

### RLS Policies
```sql
[All RLS policies — one block per table]
```

### Triggers
```sql
[updated_at triggers, audit triggers, event emit triggers]
```

---

## 4. API Endpoints

### [Domain] Endpoints

#### `[METHOD] /path`
- **Auth**: [required role]
- **Request**: `{ field: type, ... }`
- **Response**: `{ field: type, ... }`
- **Errors**: `400 Bad Request` / `403 Forbidden` / `404 Not Found`

[Repeat for every endpoint]

---

## 5. Frontend Structure

[Full directory tree for each app]

[Key components with brief description]

---

## 6. Monorepo Structure

[Full tree]

---

## 7. Automation Engine

### Events

| Event | Trigger | Actions |
|-------|---------|---------|
| [event] | [what causes it] | [list of downstream actions] |

### Rule Schema
```json
{
  "trigger_event": "booking_created",
  "conditions": { "payment_type": "deposit" },
  "actions": [
    { "type": "send_sms", "template": "booking_confirmation" },
    { "type": "update_slot", "status": "held" }
  ]
}
```

---

## 8. Deployment Plan

### Step-by-step
1. [Specific step]
2. [Specific step]

### Environment Variables
```
[All env vars with descriptions]
```

### CI/CD
[GitHub Actions workflow summary]

---

## 9. Monetization

| Stream | Mechanism | Rate |
|--------|-----------|------|
| [stream] | [how it works] | [rate or tier] |

---

## 10. Scaling Plan

| Scale Point | Trigger | Action |
|-------------|---------|--------|
| 10k users | — | [specific change] |
| 100k users | — | [specific change] |
| 1M users | — | [specific change] |

---

## 11. Roadmap

| Quarter | Feature | Business Impact |
|---------|---------|----------------|
| Q1 | [feature] | [impact] |
| Q2 | [feature] | [impact] |
| Q3-Q4 | [feature] | [impact] |
