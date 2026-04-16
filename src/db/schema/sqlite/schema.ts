import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("student"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const books = sqliteTable(
  "books",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => [index("books_user_id_idx").on(t.userId)],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: id(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    chapterNumber: integer("chapter_number"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    metadataJson: text("metadata_json"),
    ...timestamps,
  },
  (t) => [index("chapters_book_id_idx").on(t.bookId)],
);

export const topics = sqliteTable(
  "topics",
  {
    id: id(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    metadataJson: text("metadata_json"),
    ...timestamps,
  },
  (t) => [index("topics_chapter_id_idx").on(t.chapterId)],
);

export const atoms = sqliteTable(
  "atoms",
  {
    id: id(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    position: integer("position").notNull().default(0),
    contentType: text("content_type"),
    sectionLabel: text("section_label"),
    ...timestamps,
  },
  (t) => [
    index("atoms_chapter_id_idx").on(t.chapterId),
    index("atoms_topic_id_idx").on(t.topicId),
  ],
);

export const atomAudio = sqliteTable(
  "atom_audio",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull().default("audio/mpeg"),
    provider: text("provider").notNull(),
    charCount: integer("char_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("atom_audio_atom_id_unique").on(t.atomId)],
);

export const files = sqliteTable(
  "files",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    originalName: text("original_name").notNull(),
    bookId: text("book_id").references(() => books.id, { onDelete: "set null" }),
    ingestionStatus: text("ingestion_status").notNull().default("pending"),
    lastError: text("last_error"),
    fileKind: text("file_kind").notNull().default("book"),
    ...timestamps,
  },
  (t) => [index("files_user_id_idx").on(t.userId)],
);

export const contents = sqliteTable(
  "contents",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => [index("contents_atom_id_idx").on(t.atomId)],
);

export const progress = sqliteTable(
  "progress",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: text("book_id").references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").references(() => chapters.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull().default("active"),
    percent: integer("percent").notNull().default(0),
    lastAtomId: text("last_atom_id").references(() => atoms.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("progress_user_id_idx").on(t.userId),
    index("progress_book_id_idx").on(t.bookId),
  ],
);

export const pdfExtractionLogs = sqliteTable(
  "pdf_extraction_logs",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    layerReached: text("layer_reached").notNull(),
    errorsJson: text("errors_json"),
    timingsJson: text("timings_json"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("pdf_extraction_logs_file_id_idx").on(t.fileId)],
);

export const atomClassifications = sqliteTable(
  "atom_classifications",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    tagsJson: text("tags_json").notNull(),
    metadataJson: text("metadata_json"),
    ...timestamps,
  },
  (t) => [index("atom_classifications_atom_id_idx").on(t.atomId)],
);

export const atomScores = sqliteTable(
  "atom_scores",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    factorsJson: text("factors_json"),
    ...timestamps,
  },
  (t) => [uniqueIndex("atom_scores_atom_id_unique").on(t.atomId)],
);

export const pyqTags = sqliteTable(
  "pyq_tags",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    annotationsJson: text("annotations_json").notNull(),
    ...timestamps,
  },
  (t) => [index("pyq_tags_atom_id_idx").on(t.atomId)],
);

export const pyqQuestions = sqliteTable(
  "pyq_questions",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    atomId: text("atom_id").references(() => atoms.id, { onDelete: "set null" }),
    questionText: text("question_text").notNull(),
    metadataJson: text("metadata_json"),
    matchScore: real("match_score"),
    ...timestamps,
  },
  (t) => [
    index("pyq_questions_file_id_idx").on(t.fileId),
    index("pyq_questions_atom_id_idx").on(t.atomId),
  ],
);

export const generatedContent = sqliteTable(
  "generated_content",
  {
    id: id(),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("pending"),
    tokenCost: integer("token_cost").notNull().default(0),
    tokenBudget: integer("token_budget").notNull().default(0),
    payload: text("payload"),
    cacheKey: text("cache_key"),
    version: integer("version").notNull().default(1),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("generated_content_atom_id_idx").on(t.atomId),
    index("generated_content_cache_key_idx").on(t.cacheKey),
  ],
);

export const studentProfiles = sqliteTable(
  "student_profiles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileJson: text("profile_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => [uniqueIndex("student_profiles_user_id_unique").on(t.userId)],
);

export const learningStyleScores = sqliteTable(
  "learning_style_scores",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visual: real("visual").notNull().default(0),
    auditory: real("auditory").notNull().default(0),
    reading: real("reading").notNull().default(0),
    kinesthetic: real("kinesthetic").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("learning_style_scores_user_id_unique").on(t.userId)],
);

export const calibrationTests = sqliteTable(
  "calibration_tests",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("calibration_tests_user_id_idx").on(t.userId)],
);

export const calibrationResponses = sqliteTable(
  "calibration_responses",
  {
    id: id(),
    testId: text("test_id")
      .notNull()
      .references(() => calibrationTests.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    answerJson: text("answer_json").notNull(),
    ...timestamps,
  },
  (t) => [index("calibration_responses_test_id_idx").on(t.testId)],
);

export const srsCards = sqliteTable(
  "srs_cards",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    easeFactor: real("ease_factor").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    dueAt: integer("due_at", { mode: "timestamp" }),
    reviewHistoryJson: text("review_history_json"),
    ...timestamps,
  },
  (t) => [
    index("srs_cards_user_id_idx").on(t.userId),
    uniqueIndex("srs_cards_user_atom_unique").on(t.userId, t.atomId),
  ],
);

export const roadmapItems = sqliteTable(
  "roadmap_items",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    atomId: text("atom_id")
      .notNull()
      .references(() => atoms.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull().default(0),
    status: text("status").notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    index("roadmap_items_user_id_idx").on(t.userId),
    uniqueIndex("roadmap_items_user_atom_unique").on(t.userId, t.atomId),
  ],
);

export const preparednessScores = sqliteTable(
  "preparedness_scores",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    quizScore: real("quiz_score").notNull().default(0),
    retentionScore: real("retention_score").notNull().default(0),
    coveragePercent: real("coverage_percent").notNull().default(0),
    weakAtomCount: integer("weak_atom_count").notNull().default(0),
    compositeScore: real("composite_score").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("preparedness_user_chapter_unique").on(t.userId, t.chapterId),
  ],
);

export const xpEvents = sqliteTable(
  "xp_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    amount: integer("amount").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("xp_events_user_id_idx").on(t.userId)],
);

export const userXp = sqliteTable(
  "user_xp",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    totalXp: integer("total_xp").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("user_xp_user_id_unique").on(t.userId)],
);

export const streaks = sqliteTable(
  "streaks",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("streaks_user_id_unique").on(t.userId)],
);

export const badges = sqliteTable(
  "badges",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [uniqueIndex("badges_slug_unique").on(t.slug)],
);

export const userBadges = sqliteTable(
  "user_badges",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: text("badge_id")
      .notNull()
      .references(() => badges.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("user_badges_user_badge_unique").on(t.userId, t.badgeId),
  ],
);

export const learningSessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    currentAtomIndex: integer("current_atom_index").notNull().default(0),
    mode: text("mode").notNull().default("auto"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    durationMs: integer("duration_ms"),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("session_events_session_id_idx").on(t.sessionId)],
);

export const interactionEvents = sqliteTable(
  "interaction_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    atomId: text("atom_id").references(() => atoms.id, { onDelete: "set null" }),
    sessionId: text("session_id").references(() => learningSessions.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    durationMs: integer("duration_ms"),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("interaction_events_user_id_idx").on(t.userId),
    index("interaction_events_session_id_idx").on(t.sessionId),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  books: many(books),
  files: many(files),
  profile: one(studentProfiles),
  learningStyles: one(learningStyleScores),
}));

export const booksRelations = relations(books, ({ one, many }) => ({
  user: one(users, { fields: [books.userId], references: [users.id] }),
  chapters: many(chapters),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  book: one(books, { fields: [chapters.bookId], references: [books.id] }),
  atoms: many(atoms),
  topics: many(topics),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  chapter: one(chapters, { fields: [topics.chapterId], references: [chapters.id] }),
  atoms: many(atoms),
}));

export const atomsRelations = relations(atoms, ({ one, many }) => ({
  chapter: one(chapters, { fields: [atoms.chapterId], references: [chapters.id] }),
  topic: one(topics, { fields: [atoms.topicId], references: [topics.id] }),
  contents: many(contents),
  classifications: many(atomClassifications),
  scores: one(atomScores),
  pyq: many(pyqTags),
  pyqQuestions: many(pyqQuestions),
  generated: many(generatedContent),
  audio: one(atomAudio, { fields: [atoms.id], references: [atomAudio.atomId] }),
}));

export const atomAudioRelations = relations(atomAudio, ({ one }) => ({
  atom: one(atoms, { fields: [atomAudio.atomId], references: [atoms.id] }),
}));

export const pyqQuestionsRelations = relations(pyqQuestions, ({ one }) => ({
  file: one(files, { fields: [pyqQuestions.fileId], references: [files.id] }),
  atom: one(atoms, { fields: [pyqQuestions.atomId], references: [atoms.id] }),
}));

export const filesRelations = relations(files, ({ many }) => ({
  pyqQuestions: many(pyqQuestions),
}));

export const learningSessionsRelations = relations(
  learningSessions,
  ({ one, many }) => ({
    user: one(users, { fields: [learningSessions.userId], references: [users.id] }),
    book: one(books, { fields: [learningSessions.bookId], references: [books.id] }),
    chapter: one(chapters, {
      fields: [learningSessions.chapterId],
      references: [chapters.id],
    }),
    events: many(sessionEvents),
  }),
);
