# Dextora Backend Architecture

## Table of Contents
1. [System Overview](#system-overview)
2. [Core Layers](#core-layers)
3. [Database Layer](#database-layer)
4. [Application Core](#application-core)
5. [API Layer](#api-layer)
6. [Business Logic Layer](#business-logic-layer)
7. [Infrastructure Services](#infrastructure-services)
8. [Job Queue System](#job-queue-system)
9. [Module Architecture](#module-architecture)
10. [Data Flow](#data-flow)
11. [Cross-Cutting Concerns](#cross-cutting-concerns)
12. [Deployment Architecture](#deployment-architecture)

---

## System Overview

The Dextora backend is a modular, multi-layered Node.js/Express application built with TypeScript. It implements a domain-driven design with clear separation between HTTP concerns, business logic, and data persistence. The system supports multi-database drivers (PostgreSQL) and provides asynchronous job processing capabilities.

**Core Technology Stack:**
- **Runtime**: Bun (with Node.js compatibility layer planned)
- **Framework**: Express.js
- **ORM**: Drizzle ORM
- **Database Drivers**: PostgreSQL
- **Validation**: Zod (schema validation for inputs)
- **Authentication**: JWT (JSON Web Tokens)
- **Caching**: Redis (optional)
- **Storage**: Local filesystem or S3
- **External AI**: Google Generative AI (Gemini)
- **Rate Limiting**: express-rate-limit

---

## Core Layers

The backend follows a layered architecture pattern with clear boundaries between concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Client Layer                    │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Express Application (app.ts)               │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Middleware Pipeline                     │ │
│  │  (Logger → Security → CORS → Rate Limit)           │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Route & Request Handlers                   │
│  (api/v1/{auth, users, content, files, ...})            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Business Logic Services                    │
│  (auth.service, content.service, session.service, ...)  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Data Access Layer (ORM)                    │
│                 Drizzle ORM Layer                       │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│            Database Abstraction Layer                   │
│  (Data Driver ←→ PostgreSQL)                            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│          Physical Database Storage                      │
│  PostgreSQL instance)                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Database Layer

### Database Architecture

The database layer provides abstraction and flexibility for different database drivers while maintaining identical query interfaces across environments.

#### Database Support

**PostgreSQL (Production)**
- **Connection**: Remote/managed server via `postgres://` URL
- **Driver**: `postgres-js` library
- **ORM**: `drizzle-orm/postgres-js`
- **Connection Pooling**: Max 10 connections
- **Advantages**: Multi-client support, scalability, advanced features
- **File Location**: `src/db/schema/postgres/schema.ts`

#### Database Configuration

Configuration is handled by:
1. **`drizzle.config.ts`**: Migration and schema generation settings
   - Dynamically selects schema based on `DATABASE_DRIVER` environment variable
   - Generates migrations in `./drizzle` directory
   - PostgreSQL dialects

2. **`src/db/client.ts`**: Runtime database initialization
   ```
   Environment Variables:
   - DATABASE_DRIVER: "postgresql"
   - DATABASE_URL: connection string (PostgreSQL)
   ↓
   createDb(env) function creates AppDb instance
   ↓
   Returns typedd Drizzle instance 
   ```

3. **`src/db/global.ts`**: Global database singleton
   - Provides methods: `getDb()` and `getDbDriver()`
   - Centralizes database instance across application
   - Ensures single connection pool per process

### Database Schema

#### Schema Structure

The schema is organized hierarchically to represent the domain model:

```
users (Central Entity)
├── id (UUID, Primary Key)
├── email (Unique, indexed)
├── passwordHash
├── role (student, teacher, admin)
├── timestamps (createdAt, updatedAt)
└── Relations:
    ├── books (1:N) - Content units created by user
    ├── files (1:N) - Uploaded documents by user
    ├── sessions (1:N) - Learning sessions
    └── progress (1:N) - Learning progress tracking
    
books (Content Hierarchy Level 1)
├── userId (Foreign Key → users, cascade delete)
├── title
├── timestamps
└── Relations:
    └── chapters (1:N)

chapters (Content Hierarchy Level 2)
├── bookId (Foreign Key → books, cascade delete)
├── title
├── position (ordering)
├── timestamps
└── Relations:
    └── atoms (1:N)

atoms (Content Hierarchy Level 3 - Fundamental Unit)
├── chapterId (Foreign Key → chapters, cascade delete)
├── body (content)
├── position (ordering)
├── timestamps
└── Relations:
    ├── contents (1:N) - Generated content from atoms
    └── progress (1:N) - Learning progress on specific atoms

files (User Uploads)
├── userId (Foreign Key → users, cascade delete)
├── bookId (Foreign Key → books, optional, set null on delete)
├── storageKey (reference to S3/local storage)
├── mime (file type)
├── size
├── originalName
└── timestamps

contents (AI-Generated Content)
├── atomId (Foreign Key → atoms, cascade delete)
├── type (priority | background | example | etc.)
├── text (generated content)
├── metadata (optional JSON)
└── timestamps

progress (Learning Progress Tracking)
├── userId (Foreign Key → users, cascade delete)
├── atomId (Foreign Key → atoms, cascade delete)
├── sessionId (Foreign Key → sessions)
├── status (not-started | in-progress | completed)
├── score (competency metric 0-100)
├── timestamps
└── Unique constraint: (userId, atomId) per session

sessions (Learning Sessions)
├── userId (Foreign Key → users, cascade delete)
├── chapterId (Foreign Key → chapters)
├── mode (manual | adaptive | review)
├── startedAt
├── completedAt (nullable)
├── timestamps
└── Relations:
    └── progress (1:N) - Progress within this session

preparedness (Pre-requisite Readiness)
├── userId (Foreign Key → users, cascade delete)
├── chapterId (Foreign Key → chapters, cascade delete)
├── score (0-100, prerequisite mastery)
├── lastCalculatedAt
└── Unique constraint: (userId, chapterId)

gamification_profiles (User Gamification State)
├── userId (Foreign Key → users, cascade delete, unique)
├── totalXp
├── level
├── badges (JSON array)
└── timestamps
```

#### Indexed Columns

All foreign keys are indexed for query performance:
- `files_user_id_idx`
- `books_user_id_idx`
- `chapters_book_id_idx`
- `atoms_chapter_id_idx`
- `progress_user_atom_idx`
- `progress_session_idx`
- `preparedness_user_idx`
- `users_email_idx` (unique)

#### Timestamp Strategy

Every table includes:
- `created_at`: Set at insert, never modified
- `updated_at`: Set at insert, automatically updated on any modification
- Timezone aware (PostgreSQL)
- Automatically managed by Drizzle ORM

#### Cascading Delete Rules

- User deletion cascades to: books, files, progress, sessions, preparedness, gamification_profiles
- Book deletion cascades to: chapters, files (soft delete via SET NULL for unreferenced files)
- Chapter deletion cascades to: atoms
- Atom deletion cascades to: contents, progress

### Database Connection Flow

```
Application Start (server.ts)
↓
loadEnv() → reads DATABASE_DRIVER and DATABASE_URL
↓
createDb(env) → instantiates ORM client
  └─ if PostgreSQL: postgres() + drizzlePg()
↓
setDb(db, driver) → stores in global singleton
↓
Services access database via getDb()
```

### Migration and Schema Management

**Schema Generation**
```bash
bun run db:generate  # Creates migration files in ./drizzle
```

**Migration Execution**
```bash
bun run db:migrate   # Applies migrations to target database
```

**Schema Rollback**
```bash
bun run db:rollback  # Reverts last migration (scripts/db-rollback.ts)
```

**Schema Introspection**
```bash
bun run db:studio   # Drizzle Studio UI for schema exploration
```

---

## Application Core

### Initialization Pipeline (`server.ts`)

```
1. Load Environment (loadEnv)
   └─ Validate and parse all env variables with Zod schemas
   
2. Create Database Connection (createDb)
   └─ Select driver based on DATABASE_DRIVER env var
   
3. Set Global Database (setDb)
   └─ Store db instance for singleton access
   
4. Create Cache (createCache)
   └─ Initialize Redis or NoopCache based on REDIS_URL
   
5. Register Job Handlers (registerJobHandlers)
   └─ Set up queue job type handlers and their logic
   
6. Create Express App (createApp)
   └─ Build middleware pipeline and route handlers
   
7. Start Server (app.listen)
   └─ Listen on PORT env variable
```

### Worker Process (`worker.ts`)

- Alternative entry point for async job processing
- Initializes same components as server (no app listening)
- Registers same job handlers
- Currently MVP: runs in same process as API server
- Future: designed for migration to separate long-lived process
- Can be replaced with Redis consumer (BullMQ pattern) for distributed architecture

---

## Application Core

### Application Initialization (`app.ts`)

The Express application is created by `createApp(env, cache)` and configured with:

#### Middleware Stack (Execution Order)

```
1. Helmet
   └─ Security headers (X-Frame-Options, Content-Security-Policy, etc.)

2. CORS
   └─ Cross-Origin Resource Sharing configuration

3. Request Logger
   └─ Logs all incoming requests (method, path, timing)

4. Express JSON Parser
   └─ Parses application/json bodies (10MB limit)

5. Health Check Router
   └─ GET /health for load balancer probes

6. API v1 Router
   ├─ Rate Limiter (applied to all /api/v1 routes)
   ├─ /auth → Authentication routes
   ├─ /users → User management
   ├─ /content → Learning content
   ├─ /files → File upload/download
   ├─ /progress → Learning progress
   ├─ /sessions → Learning sessions
   ├─ /preparedness → Prerequisite readiness
   ├─ /students → Student management
   └─ /gamification → Gamification endpoints

7. Error Handler
   └─ Global error handling and response formatting
```

#### Environment Configuration

All application behavior is controlled via environment variables validated at startup:

```
Database Configuration:
- DATABASE_DRIVER: "postgresql"
- DATABASE_URL: connection string or file path

Authentication:
- JWT_SECRET: min 32 characters
- JWT_EXPIRES_IN: duration (default: 7d)

AI Integration:
- GEMINI_API_KEY: Google API key
- GEMINI_MODEL: Model identifier

Storage:
- STORAGE_DRIVER: "local" | "s3"
- STORAGE_LOCAL_DIR: local upload directory
- S3_*, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY

Cache:
- REDIS_URL: Redis connection string (optional)

Rate Limiting:
- RATE_LIMIT_WINDOW_MS: request window (default: 900,000ms)
- RATE_LIMIT_MAX: max requests per window (default: 300)

Runtime:
- PORT: server port (default: 4000)
- NODE_ENV: development | production | test
```

---

## API Layer

### Request-Response Pipeline

```
HTTP Request
    ↓
Router Matching (/api/v1/...)
    ↓
Route-Specific Middleware
├─ requireAuth (JWT verification)
├─ requireRole (role-based access)
├─ validate (Zod schema validation)
└─ multer (file upload handling)
    ↓
Route Handler (Express async handler wrapper)
    ├─ Calls business service
    ├─ Handles errors (HTTP exceptions)
    └─ Returns typed response
    ↓
Error Handler Middleware
    ├─ HttpError exceptions → formatted responses
    ├─ Validation errors → 422 with field details
    └─ Unhandled errors → 500 with safe message
    ↓
HTTP Response (JSON)
```

### Route Structure

Each module follows a consistent pattern:

**Pattern**: `src/modules/{feature}/{feature}.routes.ts`

```typescript
export function {feature}Router(env: Env): Router {
  const router = express.Router();
  
  // Routes within this router:
  // GET, POST, PUT, DELETE operations
  
  // Each route:
  // 1. Path matching
  // 2. Input validation (reqBody, query, params)
  // 3. Authentication check
  // 4. Authorization check
  // 5. Service call
  // 6. Response formatting
  
  return router;
}
```

### Authentication & Authorization

**JWT-Based Authentication**
1. Client sends `Authorization: Bearer <token>` header
2. Middleware extracts and verifies token
3. Token decoded to contain: `{ sub: userId, role: userRole }`
4. `req.user` populated with `{ id, role }`

**Request Wrapping Pattern**
- Use `requireAuth(env)` middleware to require authentication
- Use `requireRole(...roles)` to check user role
- Authenticated routes: `router.get(path, requireAuth(env), ..., handler)`

**Roles**
- `student`: Basic learner
- `teacher`: Content creator and instructor
- `admin`: System administrator

### Input Validation Layer

**Pattern**: Zod-based schema validators in module directories

**Validation Middleware**
```typescript
export function validate(schema: z.ZodTypeAny, part: "body" | "query" | "params")
  ├─ Parses input from request
  ├─ Validates against Zod schema
  ├─ On success: stores in req.validatedBody/Query/Params
  └─ On failure: passes ZodError to error handler
```

**Usage**
```
router.post("/path", 
  validate(createUserSchema, "body"),
  (req) => { 
    const validated = req.validatedBody;
  }
)
```

### Error Handling

**HTTP Error Class** (`src/common/http-error.ts`)
- Structured error with status code and message
- Factory methods: `HttpError.badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`, `internalServerError()`

**Error Handler Middleware**
1. Catches all errors (thrown or passed to `next()`)
2. Route handlers must explicitly call `next(error)`
3. Formats errors for response:
   ```json
   {
     "error": {
       "message": "Human-readable message",
       "code": "ERROR_CODE" (optional)
     }
   }
   ```
4. Validation errors include field-level details
5. Hides sensitive error info in production

---

## Business Logic Layer

### Service Architecture

Services encapsulate domain logic and coordinate between routes and database:

**Pattern**: Each feature has a service
- `src/modules/{feature}/{feature}.service.ts`
- Single responsibility per service
- Dependency injection through constructor
- All database operations abstracted

**Service Types**

1. **Module Services** (`src/modules/*/service.ts`)
   - `auth.service.ts`: Password hashing, token generation
   - `content.service.ts`: Content retrieval and organization
   - `progress.service.ts`: Progress tracking and scoring
   - `sessions.service.ts`: Session management
   - `students.service.ts`: Student enrollment
   - `users.service.ts`: User profile management

2. **Infrastructure Services** (`src/services/*/service.ts`)
   - `ai/gemini.client.ts`: LLM API calls
   - `generation/generation-coordinator.service.ts`: Content orchestration
   - `gamification/awarding.service.ts`: XP and badge logic
   - `preparedness/preparedness.service.ts`: Prerequisite computation
   - `ingestion/*.service.ts`: Multi-layer PDF processing pipeline
   - `sessions/session.service.ts`: Core session logic
   - `sessions/manual-learning-mode.service.ts`: Learning mode logic

### Data Access Pattern

Services access database through the singleton:
```typescript
import { getDb } from "../db/global.js";

export class MyService {
  async getItem(id: string) {
    const db = getDb();
    return db.query.items.findFirst({
      where: eq(items.id, id)
    });
  }
}
```

No repository pattern; services directly use Drizzle queries.

### Transaction Handling

Explicit transaction wrapping within services:
```typescript
await db.transaction(async (tx) => {
  // Multiple operations atomicity
  await tx.insert(users).values(...);
  await tx.update(settings).set(...);
});
```

---

## Infrastructure Services

### PDF Ingestion Pipeline

Multi-layer content extraction and processing:

```
Layer 1: PDF Structure (layer1-structure.service.ts)
  └─ Parse PDF into hierarchical sections
     (books → chapters → atoms)

Layer 2: Content Extraction (layer2-content-extract.service.ts)
  └─ Extract raw text, metadata from sections
     
Layer 3: Classification (layer3-classify.service.ts)
  └─ AI: classify content types
     (definition, example, theorem, etc.)
     
Layer 4: Scoring (layer4-score.service.ts)
  └─ Importance/difficulty scoring
  
Layer 5: Curriculum Mapping (layer5-curriculum-map.service.ts)
  └─ Map to curriculum standards
  
Layer 6: Previous Year Questions (layer6-pyq.service.ts)
  └─ Associate with past papers/exams

Orchestrator (pdf-ingestion-orchestrator.service.ts)
  └─ Coordinates layer execution
     Enqueues jobs for async processing
```

### AI/LLM Integration

**Gemini Client** (`services/ai/gemini.client.ts`)
- Direct API wrapper around Google Generative AI
- Methods: `generateContent()`, `countTokens()`
- Token budget management and tracking

**Generation Coordinator** (`services/generation/generation-coordinator.service.ts`)
- Orchestrates content generation workflows
- Manages AI calls with error recovery
- Integrates with job queue for async generation

### Gamification System

**Awarding Service** (`services/gamification/awarding.service.ts`)
- XP calculation engine
- Badge/achievement assignment logic
- Level progression tracking
- Integration with database updates

### Caching Strategy

**Redis Abstraction** (`services/cache/redis-cache.ts`)
```
CachePort Interface:
├─ get(key): Promise<string | null>
└─ set(key, value, ttlSeconds?): Promise<void>

Implementations:
├─ RedisCache: Uses ioredis client with TTL support
└─ NoopCache: No-op for deployments without Redis
```

**Cache Usage Pattern**
```typescript
const cache = getCache();  // Injected from app
const cached = await cache.get("key");
if (cached) return JSON.parse(cached);

const result = await service.expensiveOperation();
await cache.set("key", JSON.stringify(result), 3600);
return result;
```

### Storage Abstraction

**Storage Factory** (`services/storage/storage-factory.ts`)
```
StorageAdapter Interface:
├─ upload(file, path): Promise<storageKey>
├─ download(key): Promise<Buffer>
├─ delete(key): Promise<void>
└─ getUrl(key): string

Implementations:
├─ LocalStorageAdapter
│  └─ Files in STORAGE_LOCAL_DIR (default: ./uploads)
│     Metadata stored in database
│     
└─ S3StorageAdapter
   └─ AWS S3 via aws-sdk
      Files keyed by UUID
      Public/private URLs generated
```

---

## Job Queue System

### Queue Architecture

**In-Memory Queue** (MVP Pattern) (`services/queue/in-memory-queue.ts`)
```
Features:
├─ Process-local job storage
├─ FIFO queue per job type
├─ Async handler execution
├─ Error retry logic
└─ Status tracking (pending, processing, completed, failed)

Current State:
├─ Registered in same process as API server
├─ Handles jobs synchronously after API request
└─ Suitable for single-instance deployments
```

**Queue Global** (`services/queue/queue-global.ts`)
- Singleton accessor: `getQueue()`
- Used by services to enqueue jobs

**Queue Singleton** (`services/queue/queue-singleton.ts`)
- Hidden initialization, accessed globally

### Job Types & Contracts

**Defined Job Types** (`jobs/contracts/job-schemas.ts`)

```
Job Types & Payloads:

1. extract-pdf
   Payload: { fileId: UUID }
   Triggered: User uploads PDF file
   Handler: Calls ingestion pipeline
   
2. classify-atoms
   Payload: { fileId: UUID }
   Triggered: After PDF extraction
   Handler: AI classification of content atoms
   
3. generate-priority-content
   Payload: { atomIds: UUID[] }
   Triggered: User views atom, content not generated
   Handler: Gemini API call for priority content
   
4. generate-background-content
   Payload: { atomIds: UUID[] }
   Triggered: Background task scheduling
   Handler: Lower-priority content generation
   
5. recalculate-preparedness
   Payload: { userId: UUID, chapterId: UUID }
   Triggered: Progress update
   Handler: Prerequisite score recalculation
   
6. award-xp-and-badges
   Payload: { userId: UUID, source: string, amount: int, metadata?: object }
   Triggered: Learning milestones
   Handler: Gamification system update
   
7. schedule-srs-reviews
   Payload: { userId: UUID, sessionId: UUID }
   Triggered: Session completion
   Handler: Spaced repetition scheduling
```

### Job Handler Registration

**Pattern** (`jobs/register-handlers.ts`)

```typescript
export function registerJobHandlers(queue: Queue, env: Env) {
  queue.on("extract-pdf", async (payload) => {
    // Validate schema
    // Call appropriate service
    // Update job status
  });
  
  // ... register all handler types
}
```

Handlers are registered on:
- API server startup (synchronous processing in main process)
- Worker process startup (independent processing)

### Job Enqueue Pattern

From any service:
```typescript
import { getQueue } from "../../services/queue/queue-global.js";

export class ContentService {
  async uploadFile(fileId: string) {
    // Store file
    
    // Enqueue async job
    getQueue().enqueue("extract-pdf", { fileId });
  }
}
```

---

## Module Architecture

### Module Structure Pattern

Each feature module follows a standardized structure:

```
src/modules/{feature}/
├─ {feature}.routes.ts       → HTTP endpoints
├─ {feature}.service.ts      → Business logic
├─ {feature}.validators.ts   → Zod schemas
└─ (optional) {feature}.types.ts  → TypeScript types
```

### Module List

**Authentication Module** (`modules/auth/`)
- Routes: Login, register, token refresh
- Service: Password verification, JWT generation
- Validators: Email format, password strength

**Users Module** (`modules/users/`)
- Routes: Profile retrieval, update, deletion
- Service: User query/mutations
- Validators: Profile update schemas

**Content Module** (`modules/content/`)
- Routes: List books, chapters, atoms; retrieve content
- Service: Content hierarchy traversal, filtering
- Validators: Pagination, filtering schemas

**Files Module** (`modules/files/`)
- Routes: Upload file, download file, list uploads
- Service: File storage coordination, metadata tracking
- Validators: File type, size constraints

**Progress Module** (`modules/progress/`)
- Routes: Get progress, update progress, get scores
- Service: Progress calculation, score aggregation
- Validators: Progress update schemas

**Sessions Module** (`modules/sessions/`)
- Routes: Create session, get session, end session
- Service: Session lifecycle, mode coordination
- Validators: Session creation schemas

**Preparedness Module** (`modules/preparedness/`)
- Routes: Get preparedness scores, recalculate
- Service: Prerequisite analysis
- Validators: Chapter filters

**Students Module** (`modules/students/`)
- Routes: Enroll student, get roster, get stats
- Service: Student management
- Validators: Enrollment schemas

**Gamification Module** (`modules/gamification/`)
- Routes: Get profile, get badges, get leaderboard
- Service: Gamification state and calculations
- Validators: Profile retrieval schemas

---

## Data Flow

### Typical Request-to-Database Flow

```
1. CLIENT SENDS REQUEST
   POST /api/v1/auth/login
   Content-Type: application/json
   { "email": "user@example.com", "password": "..." }

2. REQUEST ENTERS MIDDLEWARE PIPELINE
   → RequestLogger: logs request
   → RateLimit middleware: checks limits
   → Express JSON parser: parses body

3. ROUTER MATCHING
   → app.routes["/api/v1/auth"](request)

4. HANDLER-SPECIFIC MIDDLEWARE
   → validate(loginSchema, "body"): validates email/password
     ├─ If invalid: ZodError → error handler → 422 response
     └─ If valid: req.validatedBody populated

5. ROUTE HANDLER EXECUTION
   → authRouter.post("/login", handler)
   → handler calls AuthService.login()

6. SERVICE LAYER
   → AuthService.login(email, password)
   ├─ getDb() retrieves database instance
   ├─ db.query.users.findFirst({ where: eq(users.email, email) })
   │  └─ Drizzle ORM → SQL translation → PostgreSQL query
   ├─ bcrypt.compare(password, user.passwordHash)
   ├─ jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET)
   └─ Returns { user, token }

7. DATABASE QUERY EXECUTION
   SQL Query:
   SELECT * FROM users WHERE email = $1
   ↓ PostgreSQL Driver (postgres-js)
   ↓ Database Engine
   ↓ Returns: {id, email, passwordHash, role, createdAt, updatedAt}

8. SERVICE RETURNS RESULT
   → Returns to handler

9. HANDLER FORMATS RESPONSE
   → HTTP 200 OK
   → Content-Type: application/json
   → Body: { user: {...}, token: "eyJhbGc..." }

10. MIDDLEWARE - ERROR HANDLER
    → If error occurred: formats as {error: {message: "..."}}

11. CLIENT RECEIVES RESPONSE
    → Parses JSON
    → Extracts token for future requests
```

### Async Job Processing Flow

```
1. SERVICE ENQUEUES JOB
   const queue = getQueue();
   queue.enqueue("extract-pdf", { fileId: "uuid-123" });
   ↓
   Job added to in-memory queue (immediate in MVP)

2. API RESPONSE RETURNS
   Client doesn't wait for job completion
   
3. JOB HANDLER EXECUTION (in same process in MVP)
   queue.on("extract-pdf", async (payload) => {
     ├─ Validate schema
     ├─ Service execution:
     │  ├─ getDb() 
     │  ├─ File lookup
     │  ├─ PDF processing layers 1-6
     │  ├─ Store atoms, contents in database
     │  └─ Enqueue follow-up jobs (classify-atoms, generate-content)
     └─ Update job status
   })

4. CASCADING JOBS
   extract-pdf → enqueue classify-atoms
   classify-atoms → enqueue generate-priority-content
   
5. ERROR HANDLING
   Job fails → logged → optionally retry
   (Retry logic not fully implemented in MVP)
```

---

## Cross-Cutting Concerns

### Authentication & Security

**JWT Token Structure**
```
Header: { "alg": "HS256", "typ": "JWT" }
Payload: { "sub": "<userId>", "role": "<userRole>", "iat": <timestamp>, "exp": <timestamp> }
Signature: HMAC_SHA256(header + payload, JWT_SECRET)

Token Lifetime: 7 days (configurable via JWT_EXPIRES_IN)
Secret: Minimum 32 characters (enforced by Zod schema)
```

**Bearer Token Usage**
```
Client sends: Authorization: Bearer <token>
Middleware extracts: token = header.split(" ")[1]
Verifies: jwt.verify(token, JWT_SECRET) or raises Unauthorized
Populates: req.user = { id, role }
```

**Password Security**
```
Hashing: bcrypt rounds = 10 (default)
Storage: Only passwordHash stored, never plain passwords
Comparison: bcrypt.compare(plaintext, hash) for constant-time comparison
```

**Role-Based Access Control**
```
requireRole(...roles) middleware checks:
└─ If req.user present?
└─ If req.user.role in allowed roles?
└─ If not: 403 Forbidden response
```

### Request Logging

**Request Logger Middleware** (`middleware/request-logger.ts`)
```
Logs on every request:
├─ HTTP method
├─ Request path
├─ Response status
├─ Response time (ms)
└─ Timestamp

Format: Structured logging (suitable for log aggregation)
```

### Rate Limiting

**Express Rate Limiter Middleware** (`middleware/rate-limit.ts`)
```
Configuration:
├─ Window: RATE_LIMIT_WINDOW_MS (default: 900,000ms = 15 minutes)
├─ Max requests: RATE_LIMIT_MAX (default: 300)
├─ Applied to: All /api/v1/* routes
├─ Key: Client IP address
└─ Response: 429 Too Many Requests when exceeded

In-Memory Storage (MVP):
  └─ Resets across server restarts
  └─ For distributed environments: needs Redis store
```

### Error Categorization

**HTTP Error Categories**
- `400 Bad Request`: Invalid request format
- `401 Unauthorized`: Missing or invalid auth
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource doesn't exist
- `409 Conflict`: Business logic violation (unique constraint, etc.)
- `422 Unprocessable Entity`: Validation error (Zod)
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Unhandled exceptions

---

## Deployment Architecture

### Environment-Specific Configurations

```
DATABASE_DRIVER=postgresql
DATABASE_URL=postgresql://host:5432/dextora
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./uploads
REDIS_URL=redis://host:6379
JWT_SECRET=(strong secret >= 32 chars)
```

### Multi-Instance Deployment

**Current Architecture (Single Instance)**
```
┌──────────────────────────────────┐
│  Bun Process                      │
├──────────────────────────────────┤
│ API Server (Express)              │
│ + In-Memory Queue                 │
│ + Job Handlers                    │
└──────────────────────────────────┘
        ↓
    PostgreSQL
```

**Planned Distributed Architecture**
```
┌─────────────────┐
│ API Instance 1  │       ┌──────────────────┐
├─────────────────┤       │ Redis Queue      │
│ Express Server  │ →→→→→→│ (BullMQ/RQ)      │
│ + Job Enqueue   │       └──────────────────┘
└─────────────────┘              ↕
                          ┌──────────────────┐
                          │ Worker Instances │
├─────────────────┐       │ Job Processing   │
│ API Instance 2  │       └──────────────────┘
├─────────────────┤              ↓
│ Express Server  │ ┌──────────────────────┐
│ + Job Enqueue   │→│  Shared PostgreSQL   │
└─────────────────┘ │  Database            │
                     │  + S3 Storage        │
                     │  + Redis Cache       │
                     └──────────────────────┘
```

### Database Connection Strategy

**PostgreSQL**
```
Connection Pool:
├─ Max connections: 10
├─ Managed by postgres-js driver
├─ Automatic reconnection on failure
└─ Shared across middleware/handlers/services

Connection String Format:
postgresql://user:password@host:port/database
```

### Storage Strategy

**Local Storage (Development)**
```
uploads/
├─ {userId}/
│  ├─ {fileId}.pdf
│  ├─ {fileId}.docx
│  └─ ...
└─ {userId}/
   ├─ ...

Metadata: Stored in database (files table)
Physical files: ./uploads/ directory
Access: Direct file reads from filesystem
```

**S3 Storage (Production)**
```
S3 Bucket Structure:
s3://bucket-name/
├─ {userId}__{fileId}
├─ {userId}__{fileId}
└─ ...

Object Metadata: Stored in database
Physical files: AWS S3 region
Access: Pre-signed URLs with TTL or public URLs
```

### Graceful Shutdown

**Server Shutdown Sequence** (not currently implemented but recommended):
```
1. Stop accepting new requests
2. Close database connections (drain pool)
3. Wait for in-flight requests to complete (timeout)
4. Close Redis connection if enabled
5. Exit process
```

### Docker Deployment

**Dockerfile**: Present in root
- Multi-stage build (if optimized)
- Bun runtime
- Database migrations run on startup
- Exposes PORT (default 4000)

**Docker Compose**: docker-compose.yml
- API service
- PostgreSQL service (optional)
- Redis service (optional)
- Environment variable injection

---

## Summary: Data & Backend Connection

### Key Connection Points

1. **Database Access**
   - All database access goes through Drizzle ORM via `getDb()` singleton
   - Services call `getDb()` to access current database instance
   - No direct SQL queries; queries through ORM

2. **Schema Abstraction**
   - Single TypeScript schema defined in `src/db/schema/postgres/schema.ts`
   - Drizzle handles SQL dialect translation (PostgreSQL)

3. **Entity Relations**
   - Hierarchy: users → books → chapters → atoms → contents & progress
   - Foreign key constraints maintained at database level
   - Cascade deletes configured for data integrity

4. **Request-to-Data Path**
   - HTTP Request → Middleware validation → Route handler → Service layer → Drizzle ORM → SQL execution → Database → Result back to client

5. **Async Processing**
   - Long-running operations (PDF ingestion, AI generation) enqueued as jobs
   - **Job queue**: `JOB_QUEUE_DRIVER=in_memory` (default) runs jobs in the API process; `JOB_QUEUE_DRIVER=redis` with `REDIS_URL` enqueues to **BullMQ** — run `bun run worker` to consume (same job handlers via `execute-job.ts`).
   - **Parse export** (preferred `POST /api/v1/parse/exports` → **202** + `_links`; legacy `POST /api/v1/parse/pdf-export` → **200** with `Deprecation` header): writes a storage manifest and `progress.json`, enqueues atom/topic/chapter generation (TTS over HTTP when `SILERO_TTS_HTTP_URL` or `SUPERTTS_HTTP_URL` is set (local Silero microservice on port 4001 is supported; see `silero-tts/README.md`); otherwise TTS cells are skipped for parse-export; per-atom `lang` `en`|`hi` from script density drives the TTS `language` field). Poll **`GET /api/v1/parse/exports/{exportId}/status`** (lightweight) or **`GET /api/v1/parse/export/{exportId}/generated`** for full artifacts; **`GET /api/v1/parse/exports/{exportId}/events`** is SSE when `REDIS_URL` or in-process fallback.
   - Jobs have access to same database connection pool

6. **Configuration-Driven Flexibility**
   - Same code runs in any mode without recompilation
   - Storage, cache, rate limiting all configurable

### Scalability Considerations

- **Single Instance**: Current state, suitable for development and small deployments
- **Horizontal Scaling**: Requires Redis for queue, shared PostgreSQL, S3 for storage
- **Connection Pooling**: PostgreSQL uses 10-connection pool; scaling may require tuning
- **Rate Limiting**: In-memory storage resets on restart; should use Redis for distributed rate limiting
- **Cache**: Optional Redis; critical for performance in high-traffic scenarios

---

## Technical Decisions & Rationale

### Why Drizzle ORM?

- Type-safe SQL builder with full TypeScript support
- Zero runtime overhead compared to query builders
- Built-in migration tooling (Drizzle Kit)
- No ORM boilerplate (no repositories, entities, decorators)

### Why Environment-Based Database Selection?

- Production readiness: PostgreSQL for multi-instance deployments
- Single codebase: No branching logic needed

### Why In-Memory Queue by Default?

- Zero infrastructure dependencies for local development
- Fast single-process job processing
- **BullMQ + Redis** optional for durable, multi-process workers (`JOB_QUEUE_DRIVER=redis`, `bun run worker`)

### Parse export async artifacts

- Manifest and per-scope JSON artifacts live under `parse-export/{userId}/{exportId}/` in configured storage (local or S3).
- **`progress.json`** (and optional Redis key `pe:p:{exportId}` when `REDIS_URL` is set) tracks `completedJobs`, `failedCells`, per-kind stats, and `ttsSucceeded` for O(1) status reads; job handlers call `recordParseExportArtifactSaved` after each artifact write (including overwrites from **`POST /api/v1/parse/exports/{id}/regenerate`**).
- **SSE**: `GET /api/v1/parse/exports/{exportId}/events` publishes JSON on the `pe:events:{exportId}` Redis channel when Redis is configured; otherwise an in-process `EventEmitter` (single Node instance only).
- **Delete**: `DELETE /api/v1/parse/exports/{exportId}` removes the prefix via `StorageAdapter.deletePrefix` (local) and clears the Redis progress key when present.
- Redis used for BullMQ is separate from optional Redis HTTP cache (`REDIS_URL` shared connection string is acceptable).
- **Throughput**: `PARSE_EXPORT_WORKER_CONCURRENCY` (per worker process) × number of worker processes; inside each atom/topic job, `PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY` runs independent Gemini/HTML branches in parallel (higher values increase provider QPS). A process-wide ceiling on simultaneous outbound HTTP calls (Gemini text/image, SuperTTS) is set via `PARSE_EXPORT_OUTBOUND_CONCURRENCY` (default 60) — high enough to preserve full throughput on healthy paths but caps pathological spikes that would saturate the event loop and starve BullMQ's lock-renewal heartbeat.
- **BullMQ** (`JOB_QUEUE_DRIVER=redis`): queue jobs use **3 attempts** with **exponential backoff** (2s base) for transient failures; local example `REDIS_URL=redis://127.0.0.1:6379` in `.env.example`. Worker tuning: `PARSE_EXPORT_JOB_LOCK_DURATION_MS` (default 600000 = 10 min) gives the heartbeat ample headroom; `PARSE_EXPORT_JOB_STALLED_INTERVAL_MS` (default 30000) and `PARSE_EXPORT_JOB_MAX_STALLED_COUNT` (default 2) tune the stall watcher.
- **Cell deadlines**: parse-export atom/topic thunks use `PARSE_EXPORT_CELL_TIMEOUT_MS` (default 180000 = 3 min); **`tts`** uses the higher `PARSE_EXPORT_TTS_CELL_TIMEOUT_MS` (default 540000 = 9 min) because Silero may synthesize long atoms as many chunks in one HTTP call; chapter thunks use `PARSE_EXPORT_CHAPTER_CELL_TIMEOUT_MS` (default 300000 = 5 min). A timed-out cell is `{status: "failed", error: "cell_deadline_exceeded"}`. Gemini text/image use `GEMINI_*_TIMEOUT_MS`; SuperTTS HTTP timeouts scale with input length (`SUPERTTS_BASE_TIMEOUT_MS` / `SUPERTTS_MAX_TIMEOUT_MS` / `SUPERTTS_MAX_ATTEMPTS`, defaults **90000** / **480000** / **4`).
- **SuperTTS**: HTTP client retries **429** and **5xx** / transient network errors (bounded by `SUPERTTS_MAX_ATTEMPTS`, backoff); local Silero (`silero-tts/app.py`) **sentence-chunks** long input before inference. The Node client still **truncates** further on stubborn “too long” errors before failing.
- **Public URLs**: optional `PUBLIC_API_BASE_URL` (no trailing slash) prefixes parse-export TTS `audioUrl` so mobile or offline clients get absolute links; unset keeps `/api/v1/files/audio?...` paths.
- **HTML policy**: `PARSE_EXPORT_HTML_VERIFY_MODE` is `relaxed` (default) or `strict`; `PARSE_EXPORT_HTML_MAX_BYTES` caps generated game HTML size. Relaxed mode keeps `window.DEXTORA_COMPLETE`, blocks networking (`fetch`, remote script src), and allows SVG/MathML URIs and richer HTML5; **`Function(` is blocked only in strict mode** (LLM microgames occasionally emit that substring harmlessly).
- **Image prompts**: export JSON includes `prompts.illustrationImage` per atom, topic, and chapter for external image APIs (no image bytes generated in-core unless extended later).

### Why Service + Route Separation?

- Clear separation of concerns
- Services testable independent of HTTP layer
- Easy to add GraphQL/gRPC without duplicating logic
- Routes handle HTTP concerns only (headers, status codes)

### Why Zod Validators?

- Runtime validation with type inference
- Composable schemas
- Well-integrated with TypeScript
- Better error messages than alternative validators

---

## File Organization Reference

```
Backend Structure Map:

src/
├── app.ts (Express app factory)
├── server.ts (API server entry point)
├── worker.ts (Job processor entry point)
│
├── config/
│   └── env.ts (Environment variable loading and validation)
│
├── db/
│   ├── client.ts (Database factory)
│   ├── global.ts (Singleton accessor)
│   └── schema/
│       └── postgres/ (PostgreSQL schema)
│
├── common/
│   ├── http-error.ts (Error class)
│   ├── auth-user.ts (Auth types)
│   ├── async-handler.ts (Error wrapper utility)
│   ├── request-types.ts (Express extensions)
│   └── request-user.ts (User context)
│
├── middleware/
│   ├── auth.ts (JWT verification)
│   ├── validate.ts (Zod schema validation)
│   ├── error-handler.ts (Global error catching)
│   ├── rate-limit.ts (Request throttling)
│   └── request-logger.ts (HTTP logging)
│
├── modules/
│   ├── auth/ (Authentication)
│   ├── users/ (User management)
│   ├── content/ (Learning content)
│   ├── files/ (File handling)
│   ├── progress/ (Learning tracking)
│   ├── sessions/ (Learning sessions)
│   ├── preparedness/ (Prerequisite analysis)
│   ├── students/ (Student management)
│   └── gamification/ (Reward system)
│
├── services/
│   ├── ai/ (Gemini integration)
│   ├── cache/ (Redis abstraction)
│   ├── gamification/ (Gamification logic)
│   ├── generation/ (Content generation)
│   ├── ingestion/ (PDF processing pipeline)
│   ├── preparedness/ (Prerequisite computation)
│   ├── queue/ (Job queue abstraction)
│   ├── sessions/ (Session management)
│   └── storage/ (File storage abstraction)
│
├── routes/
│   └── health.ts (Health check endpoint)
│
├── types/
│   └── express.d.ts (Express type augmentation)
│
└── jobs/
    ├── register-handlers.ts (Job handler registration)
    └── contracts/
        └── job-schemas.ts (Job payload schemas)
```

---

*Document Version: 1.0*
*Last Updated: April 15, 2026*
*Architecture Patterns: Layered + Service-Oriented + Middleware-Pipeline*
