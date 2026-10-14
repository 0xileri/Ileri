import { DEV_ACCOUNTS } from '../../shared/src/devAccounts';
import { courseContentSchema, type CourseContentInput } from '../../shared/src/content';
import { buildApp } from './app';
import { ApiClient } from './dev/client';
import { GUILD_PASS, incidentResponse, phishingDefense, spreadsheets, stayingSafeOnline } from './dev/seedContent';

// Seeds a demo through the real API, so every record goes through the same
// validation, permission and audit paths as production traffic.

const [ada, bayo, chioma, dele] = DEV_ACCOUNTS;

async function createCourse(owner: ApiClient, communityId: string, title: string, summary: string, content: CourseContentInput) {
  const { course } = await owner.ok('POST', `/api/communities/${communityId}/courses`, { title, summary });
  await owner.ok('PUT', `/api/courses/${course.id}/draft`, { content, changeNote: 'Initial version' });
  await owner.ok('POST', `/api/courses/${course.id}/publish`);
  return course.id as string;
}

export async function passQuiz(client: ApiClient, courseId: string, content: CourseContentInput) {
  const parsed = courseContentSchema.parse(content);
  const { attempt } = await client.ok('POST', `/api/courses/${courseId}/quiz/attempts`);
  const answers: Record<string, string[]> = {};
  for (const q of attempt.questions as { id: string }[]) {
    const source = parsed.quiz!.questions.find((x) => x.id === q.id)!;
    answers[q.id] = source.options.filter((o) => o.correct).map((o) => o.id);
  }
  return client.ok('POST', `/api/quiz-attempts/${attempt.id}/submit`, { answers });
}

async function finishLessons(client: ApiClient, courseId: string, content: CourseContentInput) {
  for (const m of content.modules) {
    for (const l of m.lessons) {
      await client.ok('GET', `/api/courses/${courseId}/lessons/${l.id}`);
      await client.ok('POST', `/api/courses/${courseId}/lessons/${l.id}/complete`);
    }
  }
}

async function main() {
  const app = await buildApp({ config: { jobsEnabled: false } });
  if (!app.ctx.config.devMode) throw new Error('Seeding needs DEV_MODE=true (it uses mock token balances).');
  const owner = await ApiClient.signIn(app, ada.privateKey);
  const existing = await owner.get('/api/communities/ileri-security-guild');
  if (existing.status === 200) {
    console.log('Demo data already present. Nothing to do.');
    await app.close();
    return;
  }

  const instructor = await ApiClient.signIn(app, bayo.privateKey);
  const learner = await ApiClient.signIn(app, chioma.privateKey);
  const newcomer = await ApiClient.signIn(app, dele.privateKey);
  await owner.ok('PATCH', '/api/me', { displayName: 'Ada Okafor', bio: 'Runs the Ileri Security Guild.' });
  await instructor.ok('PATCH', '/api/me', { displayName: 'Bayo Adeyemi', bio: 'Security instructor.' });
  await learner.ok('PATCH', '/api/me', { displayName: 'Chioma Eze' });
  await newcomer.ok('PATCH', '/api/me', { displayName: 'Dele Martins' });

  // Chioma holds the Guild Pass on the mock chain; Dele does not.
  await learner.ok('PUT', '/api/dev/balances', {
    owner: chioma.address,
    chainId: GUILD_PASS.chainId,
    standard: 'erc721',
    contract: GUILD_PASS.contract,
    balance: '1',
  });

  const { community: guild } = await owner.ok('POST', '/api/communities', {
    name: 'Ileri Security Guild',
    slug: 'ileri-security-guild',
    tagline: 'Practical security skills for Guild Pass holders',
    description:
      'A members-only guild for people who want to keep themselves and their communities safe online. Courses are free for pass holders, with points and course credits for verified completions.',
  });
  await owner.ok('PATCH', `/api/communities/${guild.id}`, {
    accentColor: '#2f6b4f',
    joinPolicy: { type: 'erc721', ...GUILD_PASS, minBalance: 1 },
  });

  const invite = await owner.ok('POST', `/api/communities/${guild.id}/invites`, { role: 'instructor', note: 'For Bayo' });
  await instructor.ok('POST', `/api/invites/${invite.invite.token}/accept`);

  const basics = await createCourse(owner, guild.id, 'Staying Safe Online', 'The habits that stop most account takeovers.', stayingSafeOnline);
  const phishing = await createCourse(instructor, guild.id, 'Phishing Defense in Practice', 'Analyse real messages and get your write-up reviewed.', phishingDefense);
  const incident = await createCourse(owner, guild.id, 'Incident Response: First Hour', 'What to do when an account is compromised.', incidentResponse);
  await owner.ok('PATCH', `/api/courses/${phishing}`, {
    accessPolicy: { type: 'course_completion', courseId: basics },
  });
  await owner.ok('PATCH', `/api/courses/${incident}`, { creditCost: 30 });

  await owner.ok('POST', `/api/communities/${guild.id}/campaigns`, {
    courseId: basics,
    name: 'Launch points',
    rewardKind: 'points',
    amountPerCompletion: 20,
    maxRewards: 100,
    allocationMode: 'first_approved',
    activate: true,
  });
  await owner.ok('POST', `/api/communities/${guild.id}/campaigns`, {
    courseId: phishing,
    name: 'Practitioner credits',
    rewardKind: 'course_credits',
    amountPerCompletion: 40,
    maxRewards: 25,
    allocationMode: 'reserved_at_enrollment',
    activate: true,
  });

  // Chioma completes the basics course and starts the practical one.
  await learner.ok('POST', `/api/courses/${basics}/enroll`);
  await finishLessons(learner, basics, stayingSafeOnline);
  await passQuiz(learner, basics, stayingSafeOnline);
  const rewards = await learner.ok('GET', '/api/me/rewards');
  for (const r of rewards.rewards.filter((x: { status: string }) => x.status === 'eligible')) {
    await learner.ok('POST', `/api/me/rewards/${r.id}/claim`);
  }
  await learner.ok('POST', `/api/courses/${phishing}/enroll`);
  await finishLessons(learner, phishing, phishingDefense);
  await passQuiz(learner, phishing, phishingDefense);
  await learner.ok('POST', `/api/courses/${phishing}/submissions`, {
    text: `Message: "Your Guild Pass will be burned in 2 hours unless you verify at guild-pass-verify.xyz".

Red flags:
1. Urgency: a two-hour deadline to force a quick decision.
2. Lookalike domain: guild-pass-verify.xyz is not the guild's domain.
3. Unusual request: asks me to connect a wallet and sign to "verify" a pass I already hold.

Verification: I would ignore the link, open the guild's official site from my bookmarks, and ask in the announcements channel whether any verification is happening.

Warning note: "Fake 'Guild Pass verification' DMs are going around. The guild never asks you to sign to keep your pass."`,
  });

  // A second, open community so the directory has variety.
  const { community: data } = await owner.ok('POST', '/api/communities', {
    name: 'Open Data Collective',
    slug: 'open-data-collective',
    tagline: 'Anyone can join. Learn to work with community data.',
    description: 'An open community. No token needed.',
  });
  await owner.ok('PATCH', `/api/communities/${data.id}`, { accentColor: '#7a4e2d' });
  await createCourse(owner, data.id, 'Tidy Community Data', 'Clean, share and chart community data.', spreadsheets);
  await newcomer.ok('POST', `/api/communities/${data.id}/join`);

  console.log('Seeded demo data:');
  console.log('  Ileri Security Guild  /c/ileri-security-guild  (Guild Pass required)');
  console.log('  Open Data Collective  /c/open-data-collective  (open)');
  console.log('Dev wallets (choose them on the sign-in screen):');
  for (const a of DEV_ACCOUNTS) console.log(`  ${a.label.padEnd(30)} ${a.address}`);
  await app.close();
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
