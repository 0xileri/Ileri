import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { summarizeRule } from '../../../shared/src/access';
import {
  allLessons,
  completionRequirementText,
  courseContentSchema,
  defaultCourseContent,
  publishIssues,
  type CourseContent,
} from '../../../shared/src/content';
import { loadDescribeContext } from '../access/evaluate';
import { validatePolicy } from '../access/policy';
import { requirementsFor } from '../access/requirements';
import type { AppContext } from '../context';
import { completions, courses, courseVersions, enrollments, media } from '../db/schema';
import { audit } from '../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { slugify } from '../lib/misc';
import { parse } from '../lib/validate';
import { enrollmentSummaries } from '../learning/summary';
import { liveCampaignsByCourse } from '../rewards/service';
import {
  activeMembership,
  isStaffRole,
  loadCommunity,
  requireCommunityRole,
  type Community,
} from '../permissions';

export type Course = typeof courses.$inferSelect;

export async function loadCourse(ctx: AppContext, id: string): Promise<{ course: Course; community: Community }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Course');
  const [course] = await ctx.db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!course) throw notFound('Course');
  const community = await loadCommunity(ctx.db, course.communityId);
  return { course, community };
}

/** Role of the viewer in the course's community, or null. Platform admins count as staff. */
async function viewerRole(ctx: AppContext, req: FastifyRequest, communityId: string) {
  if (!req.user) return null;
  if (req.user.isPlatformAdmin) return 'admin' as const;
  return (await activeMembership(ctx.db, communityId, req.user.id))?.role ?? null;
}

/** Outline that is safe to show before enrollment: no lesson bodies, no answers. */
export function outline(content: CourseContent) {
  return content.modules.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      kind: l.kind,
      estimatedMinutes: l.estimatedMinutes,
      required: l.required,
    })),
  }));
}

const courseMetaBody = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(48)
    .optional(),
  summary: z.string().trim().max(500).optional(),
  coverUrl: z.union([z.literal(''), z.url().max(500)]).nullable().optional(),
  creditCost: z.number().int().min(0).max(1_000_000).optional(),
  accessPolicy: z.unknown().optional(),
});

export async function courseRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get<{ Params: { id: string }; Querystring: { all?: string } }>('/communities/:id/courses', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const role = await viewerRole(ctx, req, community.id);
    if (community.status !== 'active' && !isStaffRole(role)) throw new AppError(403, 'suspended', 'This community is suspended.');
    const includeAll = req.query.all === '1' && isStaffRole(role);
    const rows = await ctx.db
      .select()
      .from(courses)
      .where(
        includeAll
          ? eq(courses.communityId, community.id)
          : and(eq(courses.communityId, community.id), eq(courses.status, 'published')),
      )
      .orderBy(asc(courses.createdAt));
    const versionIds = rows.flatMap((c) => (c.currentVersionId ? [c.currentVersionId] : []));
    const versions = versionIds.length
      ? await ctx.db
          .select({ id: courseVersions.id, content: courseVersions.content, versionNumber: courseVersions.versionNumber })
          .from(courseVersions)
          .where(inArray(courseVersions.id, versionIds))
      : [];
    const contentBy = new Map(versions.map((v) => [v.id, v]));
    const courseIds = rows.map((r) => r.id);
    const [campaigns, mine, describe] = await Promise.all([
      liveCampaignsByCourse(ctx.db, courseIds),
      req.user ? enrollmentSummaries(ctx.db, req.user.id, courseIds) : Promise.resolve(new Map()),
      loadDescribeContext(ctx.db, rows.map((r) => r.accessPolicy)),
    ]);
    return {
      courses: rows.map((c) => {
        const version = c.currentVersionId ? contentBy.get(c.currentVersionId) : undefined;
        const lessons = version ? allLessons(version.content) : [];
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          summary: c.summary,
          coverUrl: c.coverUrl,
          status: c.status,
          creditCost: c.creditCost,
          accessSummary: c.accessPolicy ? summarizeRule(c.accessPolicy, describe) : `Open to ${community.name} members`,
          lessonCount: lessons.length,
          estimatedMinutes: lessons.reduce((s, l) => s + l.estimatedMinutes, 0),
          hasCredential: Boolean(version?.content.credential.enabled),
          versionNumber: version?.versionNumber ?? null,
          campaigns: campaigns.get(c.id) ?? [],
          myEnrollment: mine.get(c.id) ?? null,
        };
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/courses', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    const body = parse(z.object({ title: z.string().trim().min(2).max(120), summary: z.string().trim().max(500).default('') }), req.body);
    let slug = slugify(body.title);
    const clash = await ctx.db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.communityId, community.id), eq(courses.slug, slug)));
    if (clash.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const result = await ctx.db.transaction(async (tx) => {
      const [course] = await tx
        .insert(courses)
        .values({ communityId: community.id, slug, title: body.title, summary: body.summary, createdBy: actor.user.id })
        .returning();
      const [version] = await tx
        .insert(courseVersions)
        .values({
          courseId: course!.id,
          communityId: community.id,
          versionNumber: 1,
          status: 'draft',
          content: defaultCourseContent(body.title),
        })
        .returning({ id: courseVersions.id });
      await audit(tx, {
        action: 'course.create',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'course',
        targetId: course!.id,
        metadata: { title: body.title },
        ip: req.ip,
      });
      return { course: course!, draftVersionId: version!.id };
    });
    return result;
  });

  app.get<{ Params: { id: string } }>('/courses/:id', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    const role = await viewerRole(ctx, req, community.id);
    const staff = isStaffRole(role);
    if ((course.status === 'draft' || community.status !== 'active') && !staff) throw notFound('Course');
    let versionId = course.currentVersionId;
    if (!versionId && staff) {
      const [draft] = await ctx.db
        .select({ id: courseVersions.id })
        .from(courseVersions)
        .where(eq(courseVersions.courseId, course.id))
        .orderBy(desc(courseVersions.versionNumber))
        .limit(1);
      versionId = draft?.id ?? null;
    }
    const [version] = versionId
      ? await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, versionId))
      : [];
    if (!version) throw notFound('Course content');
    const content = version.content;
    const [campaigns, mine, requirements, completion] = await Promise.all([
      liveCampaignsByCourse(ctx.db, [course.id]),
      req.user ? enrollmentSummaries(ctx.db, req.user.id, [course.id]) : Promise.resolve(new Map()),
      requirementsFor(ctx, [community.joinPolicy, course.accessPolicy], req.user),
      req.user
        ? ctx.db
            .select({ id: completions.id, completedAt: completions.completedAt, status: completions.status })
            .from(completions)
            .where(and(eq(completions.userId, req.user.id), eq(completions.courseId, course.id)))
        : Promise.resolve([]),
    ]);
    const lessons = allLessons(content);
    return {
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
        summary: course.summary,
        coverUrl: course.coverUrl,
        status: course.status,
        creditCost: course.creditCost,
      },
      community: {
        id: community.id,
        slug: community.slug,
        name: community.name,
        logoUrl: community.logoUrl,
        accentColor: community.accentColor,
      },
      version: { id: version.id, versionNumber: version.versionNumber, status: version.status, publishedAt: version.publishedAt },
      description: content.description,
      outcomes: content.outcomes,
      prerequisitesText: content.prerequisitesText,
      instructorName: content.instructorName,
      outline: outline(content),
      lessonCount: lessons.length,
      estimatedMinutes: lessons.reduce((s, l) => s + l.estimatedMinutes, 0),
      quiz: content.quiz
        ? {
            questionsPerAttempt: content.quiz.questionsPerAttempt,
            passPercent: content.quiz.passPercent,
            maxAttempts: content.quiz.maxAttempts,
          }
        : null,
      assignment: content.assignment ? { title: content.assignment.title } : null,
      completionRequirements: completionRequirementText(content),
      credential: content.credential.enabled ? { title: content.credential.title } : null,
      campaigns: campaigns.get(course.id) ?? [],
      access: requirements,
      viewerRole: role,
      myEnrollment: mine.get(course.id) ?? null,
      myCompletion: completion[0] ?? null,
    };
  });

  app.patch<{ Params: { id: string } }>('/courses/:id', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    const body = parse(courseMetaBody, req.body);
    const changes: Partial<typeof courses.$inferInsert> = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.summary !== undefined) changes.summary = body.summary;
    if (body.coverUrl !== undefined) changes.coverUrl = body.coverUrl || null;
    if (body.creditCost !== undefined) changes.creditCost = body.creditCost;
    if (body.slug !== undefined && body.slug !== course.slug) {
      const clash = await ctx.db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.communityId, community.id), eq(courses.slug, body.slug), ne(courses.id, course.id)));
      if (clash.length) throw conflict('Another course already uses that address.', 'slug_taken');
      changes.slug = body.slug;
    }
    const policyChanged = 'accessPolicy' in (req.body as object);
    if (policyChanged) changes.accessPolicy = await validatePolicy(ctx, community.id, body.accessPolicy, course.id);
    if (Object.keys(changes).length === 0) throw badRequest('Nothing to update.');
    await ctx.db.transaction(async (tx) => {
      await tx.update(courses).set({ ...changes, updatedAt: new Date() }).where(eq(courses.id, course.id));
      const describe = policyChanged ? await loadDescribeContext(tx, [course.accessPolicy, changes.accessPolicy]) : {};
      await audit(tx, {
        action: policyChanged ? 'course.policy_update' : 'course.update',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'course',
        targetId: course.id,
        metadata: policyChanged
          ? {
              fields: Object.keys(changes),
              before: summarizeRule(course.accessPolicy, describe),
              after: summarizeRule(changes.accessPolicy, describe),
            }
          : { fields: Object.keys(changes) },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/courses/:id/editor', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const versions = await ctx.db
      .select({
        id: courseVersions.id,
        versionNumber: courseVersions.versionNumber,
        status: courseVersions.status,
        changeNote: courseVersions.changeNote,
        publishedAt: courseVersions.publishedAt,
        updatedAt: courseVersions.updatedAt,
      })
      .from(courseVersions)
      .where(eq(courseVersions.courseId, course.id))
      .orderBy(desc(courseVersions.versionNumber));
    const enrollmentCounts = await ctx.db
      .select({ versionId: enrollments.versionId, n: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
      .groupBy(enrollments.versionId);
    const draftMeta = versions.find((v) => v.status === 'draft');
    const [draft] = draftMeta
      ? await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, draftMeta.id))
      : [];
    const [published] = course.currentVersionId
      ? await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, course.currentVersionId))
      : [];
    const describe = await loadDescribeContext(ctx.db, [course.accessPolicy]);
    const otherCourses = await ctx.db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(eq(courses.communityId, community.id), ne(courses.id, course.id)));
    return {
      course: { ...course, accessSummary: summarizeRule(course.accessPolicy, describe) },
      community: { id: community.id, slug: community.slug, name: community.name },
      versions: versions.map((v) => ({
        ...v,
        enrollmentCount: enrollmentCounts.find((e) => e.versionId === v.id)?.n ?? 0,
      })),
      draft: draft ? { id: draft.id, versionNumber: draft.versionNumber, content: draft.content, changeNote: draft.changeNote, issues: publishIssues(draft.content) } : null,
      published: published ? { id: published.id, versionNumber: published.versionNumber, content: published.content } : null,
      otherCourses,
      supportedChainIds: ctx.config.supportedChainIds,
    };
  });

  app.post<{ Params: { id: string } }>('/courses/:id/draft', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    return ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: courseVersions.id })
        .from(courseVersions)
        .where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.status, 'draft')));
      if (existing) return { draftVersionId: existing.id };
      const [latest] = await tx
        .select()
        .from(courseVersions)
        .where(eq(courseVersions.courseId, course.id))
        .orderBy(desc(courseVersions.versionNumber))
        .limit(1)
        .for('update');
      const base = course.currentVersionId
        ? (await tx.select().from(courseVersions).where(eq(courseVersions.id, course.currentVersionId)))[0]
        : latest;
      const [draft] = await tx
        .insert(courseVersions)
        .values({
          courseId: course.id,
          communityId: community.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          status: 'draft',
          content: base?.content ?? defaultCourseContent(course.title),
        })
        .returning({ id: courseVersions.id });
      await audit(tx, { action: 'course.draft_create', actorId: actor.user.id, communityId: community.id, targetType: 'course', targetId: course.id, ip: req.ip });
      return { draftVersionId: draft!.id };
    });
  });

  app.put<{ Params: { id: string } }>('/courses/:id/draft', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const body = parse(z.object({ content: courseContentSchema, changeNote: z.string().trim().max(500).default('') }), req.body);
    await assertLessonMedia(ctx, community.id, body.content);
    const updated = await ctx.db
      .update(courseVersions)
      .set({ content: body.content, changeNote: body.changeNote, updatedAt: new Date() })
      .where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.status, 'draft')))
      .returning({ id: courseVersions.id });
    if (!updated.length) throw conflict('There is no draft to edit. Start a new draft first.', 'no_draft');
    return { ok: true, issues: publishIssues(body.content) };
  });

  app.post<{ Params: { id: string } }>('/courses/:id/publish', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    return ctx.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(courseVersions)
        .where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.status, 'draft')))
        .for('update');
      if (!draft) throw conflict('There is no draft to publish.', 'no_draft');
      const issues = publishIssues(draft.content);
      if (issues.length) throw new AppError(400, 'not_publishable', issues[0]!, { issues });
      const now = new Date();
      // Earlier versions are retired, not deleted: enrolled learners stay on them.
      await tx
        .update(courseVersions)
        .set({ status: 'retired' })
        .where(and(eq(courseVersions.courseId, course.id), eq(courseVersions.status, 'published')));
      await tx
        .update(courseVersions)
        .set({ status: 'published', publishedAt: now, publishedBy: actor.user.id, updatedAt: now })
        .where(eq(courseVersions.id, draft.id));
      await tx
        .update(courses)
        .set({ currentVersionId: draft.id, status: 'published', updatedAt: now })
        .where(eq(courses.id, course.id));
      await audit(tx, {
        action: 'course.publish',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'course',
        targetId: course.id,
        metadata: { versionNumber: draft.versionNumber, changeNote: draft.changeNote },
        ip: req.ip,
      });
      return { ok: true, versionNumber: draft.versionNumber };
    });
  });

  app.post<{ Params: { id: string } }>('/courses/:id/archive', async (req) => {
    const { course, community } = await loadCourse(ctx, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    if (archived && course.status !== 'published') throw badRequest('Only published courses can be archived.');
    if (!archived && course.status !== 'archived') throw badRequest('This course is not archived.');
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(courses)
        .set({ status: archived ? 'archived' : 'published', updatedAt: new Date() })
        .where(eq(courses.id, course.id));
      await audit(tx, {
        action: archived ? 'course.archive' : 'course.unarchive',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'course',
        targetId: course.id,
        ip: req.ip,
      });
    });
    return { ok: true };
  });
}

async function assertLessonMedia(ctx: AppContext, communityId: string, content: CourseContent) {
  const ids = new Set<string>();
  for (const lesson of allLessons(content)) {
    if (lesson.mediaId) ids.add(lesson.mediaId);
    for (const a of lesson.attachments) ids.add(a.mediaId);
  }
  if (ids.size === 0) return;
  const rows = await ctx.db
    .select({ id: media.id })
    .from(media)
    .where(and(inArray(media.id, [...ids]), eq(media.communityId, communityId), eq(media.purpose, 'lesson')));
  if (rows.length !== ids.size) throw badRequest('Lessons can only use files uploaded to this community.');
}
