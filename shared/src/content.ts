import { z } from 'zod';

// A course version's content is stored as one immutable document once published.
// Learners are pinned to the version they enrolled in, so later edits never
// silently change what someone completed.

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'IDs may only use letters, numbers, _ and -');

export const lessonSchema = z.object({
  id,
  title: z.string().trim().min(1, 'Lesson title is required').max(200),
  kind: z.enum(['text', 'video']),
  body: z.string().max(100_000).default(''),
  videoUrl: z.union([z.literal(''), z.url().max(2000)]).default(''),
  mediaId: z.uuid().nullable().default(null),
  attachments: z
    .array(z.object({ mediaId: z.uuid(), name: z.string().trim().min(1).max(200) }))
    .max(20)
    .default([]),
  estimatedMinutes: z.number().int().min(0).max(600).default(10),
  required: z.boolean().default(true),
});

export const moduleSchema = z.object({
  id,
  title: z.string().trim().min(1, 'Module title is required').max(200),
  lessons: z.array(lessonSchema).max(100),
});

export const quizOptionSchema = z.object({
  id,
  text: z.string().trim().min(1, 'Option text is required').max(1000),
  correct: z.boolean(),
});

export const quizQuestionSchema = z
  .object({
    id,
    prompt: z.string().trim().min(1, 'Question prompt is required').max(4000),
    kind: z.enum(['single', 'multiple']),
    options: z.array(quizOptionSchema).min(2, 'Questions need at least two options').max(8),
  })
  .refine((q) => q.options.some((o) => o.correct), {
    message: 'Each question needs at least one correct option',
  })
  .refine((q) => q.kind === 'multiple' || q.options.filter((o) => o.correct).length === 1, {
    message: 'Single-choice questions need exactly one correct option',
  });

export const quizSchema = z.object({
  id,
  title: z.string().trim().min(1).max(200),
  passPercent: z.number().int().min(1).max(100).default(70),
  questionsPerAttempt: z.number().int().min(1).max(100).default(5),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  cooldownMinutes: z.number().int().min(0).max(10_080).default(0),
  questions: z.array(quizQuestionSchema).max(500),
});

export const rubricCriterionSchema = z.object({
  id,
  title: z.string().trim().min(1, 'Criterion title is required').max(200),
  description: z.string().max(2000).default(''),
  required: z.boolean().default(true),
});

export const assignmentSchema = z.object({
  id,
  title: z.string().trim().min(1).max(200),
  prompt: z.string().max(20_000).default(''),
  allowLink: z.boolean().default(true),
  allowFile: z.boolean().default(true),
  rubric: z.array(rubricCriterionSchema).max(30),
});

export const completionSchema = z.object({
  requireAllLessons: z.boolean().default(true),
  requireQuiz: z.boolean().default(false),
  requireAssignment: z.boolean().default(false),
});

export const credentialConfigSchema = z.object({
  enabled: z.boolean().default(true),
  title: z.string().trim().max(200).default(''),
  criteria: z.string().max(2000).default(''),
});

export const courseContentSchema = z
  .object({
    description: z.string().max(20_000).default(''),
    outcomes: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    prerequisitesText: z.string().max(2000).default(''),
    instructorName: z.string().trim().max(200).default(''),
    modules: z.array(moduleSchema).max(50),
    quiz: quizSchema.nullable().default(null),
    assignment: assignmentSchema.nullable().default(null),
    completion: completionSchema,
    credential: credentialConfigSchema,
  })
  .superRefine((content, ctx) => {
    const seen = new Set<string>();
    const check = (value: string, path: (string | number)[]) => {
      if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${value}"`, path });
      seen.add(value);
    };
    content.modules.forEach((m, mi) => {
      check(m.id, ['modules', mi, 'id']);
      m.lessons.forEach((l, li) => check(l.id, ['modules', mi, 'lessons', li, 'id']));
    });
    content.quiz?.questions.forEach((q, qi) => {
      check(q.id, ['quiz', 'questions', qi, 'id']);
      const optionIds = new Set(q.options.map((o) => o.id));
      if (optionIds.size !== q.options.length) {
        ctx.addIssue({ code: 'custom', message: 'Option ids must be unique', path: ['quiz', 'questions', qi] });
      }
    });
    content.assignment?.rubric.forEach((c, ci) => check(c.id, ['assignment', 'rubric', ci, 'id']));
  });

export type Lesson = z.infer<typeof lessonSchema>;
export type CourseModule = z.infer<typeof moduleSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export type CourseContent = z.infer<typeof courseContentSchema>;
export type CourseContentInput = z.input<typeof courseContentSchema>;

export function allLessons(content: CourseContent): Lesson[] {
  return content.modules.flatMap((m) => m.lessons);
}

export function requiredLessonIds(content: CourseContent): string[] {
  return allLessons(content)
    .filter((l) => l.required)
    .map((l) => l.id);
}

/** Problems that block publishing, written for course authors. */
export function publishIssues(content: CourseContent): string[] {
  const issues: string[] = [];
  const lessons = allLessons(content);
  if (lessons.length === 0) issues.push('Add at least one lesson.');
  for (const lesson of lessons) {
    if (lesson.kind === 'video' && !lesson.videoUrl && !lesson.mediaId) {
      issues.push(`Video lesson "${lesson.title}" needs a video link or an uploaded video.`);
    }
    if (lesson.kind === 'text' && !lesson.body.trim()) {
      issues.push(`Text lesson "${lesson.title}" has no content.`);
    }
  }
  const { completion } = content;
  if (!completion.requireAllLessons && !completion.requireQuiz && !completion.requireAssignment) {
    issues.push('Choose at least one completion requirement.');
  }
  if (completion.requireQuiz) {
    if (!content.quiz) issues.push('Completion requires a quiz, but the course has none.');
    else if (content.quiz.questions.length < content.quiz.questionsPerAttempt) {
      issues.push(
        `The quiz asks ${content.quiz.questionsPerAttempt} questions per attempt but the bank only has ${content.quiz.questions.length}.`,
      );
    }
  }
  if (completion.requireAssignment) {
    if (!content.assignment) issues.push('Completion requires an assignment, but the course has none.');
    else {
      if (content.assignment.rubric.length === 0) issues.push('The assignment needs at least one rubric criterion.');
      if (!content.assignment.prompt.trim()) issues.push('The assignment needs instructions.');
    }
  }
  if (content.credential.enabled && !content.credential.title.trim()) {
    issues.push('Give the completion credential a title.');
  }
  return issues;
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function defaultCourseContent(title: string): CourseContent {
  return courseContentSchema.parse({
    description: '',
    outcomes: [],
    modules: [
      {
        id: newId('mod'),
        title: 'Getting started',
        lessons: [
          {
            id: newId('les'),
            title: 'Welcome',
            kind: 'text',
            body: `Welcome to **${title}**. Replace this text with your first lesson.`,
          },
        ],
      },
    ],
    quiz: null,
    assignment: null,
    completion: { requireAllLessons: true, requireQuiz: false, requireAssignment: false },
    credential: { enabled: true, title: `${title} completion`, criteria: '' },
  });
}

/** Human-readable list of what a learner must do, derived from the completion settings. */
export function completionRequirementText(content: CourseContent): string[] {
  const items: string[] = [];
  if (content.completion.requireAllLessons) items.push('Finish every required lesson');
  if (content.completion.requireQuiz && content.quiz) {
    items.push(`Score at least ${content.quiz.passPercent}% on the quiz (${content.quiz.maxAttempts} attempts)`);
  }
  if (content.completion.requireAssignment && content.assignment) {
    items.push('Have your practical assignment approved by a reviewer');
  }
  return items;
}
