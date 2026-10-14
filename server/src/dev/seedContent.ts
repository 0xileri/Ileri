import type { CourseContentInput } from '../../../shared/src/content';

export const GUILD_PASS = {
  chainId: 8453,
  contract: '0x000000000000000000000000000000000000c0de',
  label: 'Guild Pass',
};

export const stayingSafeOnline: CourseContentInput = {
  description:
    'A short, practical introduction to how everyday accounts get compromised and the habits that stop most attacks. No technical background needed.',
  outcomes: [
    'Explain why attackers usually target people rather than systems',
    'Choose between passwords, password managers and passkeys',
    'Recognise the common signs of a phishing message',
  ],
  prerequisitesText: 'None. Bring an account you care about.',
  instructorName: 'Bayo Adeyemi',
  modules: [
    {
      id: 'mod_foundations',
      title: 'Foundations',
      lessons: [
        {
          id: 'les_people',
          title: 'Why attackers target people',
          kind: 'text',
          estimatedMinutes: 6,
          body: `Most breaches don't start with clever code. They start with someone being convinced to do something: open a file, approve a login, share a code.

That's not because people are careless. It's because people are **the cheapest way in**. Breaking strong encryption is expensive. Sending a thousand convincing messages is nearly free.

### What this means for you

- Your habits matter more than your antivirus.
- Urgency is a tool. Attackers manufacture it on purpose.
- "Would the real sender ask me this, this way?" is the most useful question in security.

> A good rule: slow down whenever a message asks you to act quickly.`,
        },
        {
          id: 'les_passwords',
          title: 'Passwords, managers and passkeys',
          kind: 'text',
          estimatedMinutes: 8,
          body: `Reused passwords are the single biggest everyday risk. When one site leaks, attackers try the same email and password everywhere else.

### The practical setup

1. **Use a password manager.** It creates a unique, long password for every site and remembers it for you.
2. **Turn on passkeys where offered.** A passkey can't be phished because it only works on the real site.
3. **Add a second factor** to your email first. Whoever controls your email can reset everything else.

### What to avoid

- SMS codes are better than nothing, but an authenticator app or passkey is stronger.
- Never read a one-time code to someone who calls you. Real support teams don't ask for it.`,
        },
      ],
    },
    {
      id: 'mod_phishing',
      title: 'Recognising phishing',
      lessons: [
        {
          id: 'les_redflags',
          title: 'Five red flags in a message',
          kind: 'text',
          estimatedMinutes: 7,
          body: `Phishing messages vary, but they lean on the same tricks.

| Red flag | Example |
| --- | --- |
| Urgency | "Your account will be closed in 2 hours" |
| Mismatched sender | Display name says your bank, address is a random domain |
| Lookalike links | \`paypa1.com\`, \`login-micros0ft.co\` |
| Unusual requests | Gift cards, seed phrases, one-time codes |
| Too good to be true | Surprise airdrops, refunds you didn't ask for |

When in doubt, **don't use the link in the message**. Open the app or type the address yourself.`,
        },
      ],
    },
  ],
  quiz: {
    id: 'quiz_basics',
    title: 'Check your understanding',
    passPercent: 75,
    questionsPerAttempt: 4,
    maxAttempts: 3,
    cooldownMinutes: 0,
    questions: [
      {
        id: 'q1',
        prompt: 'Which account should you protect with a second factor first?',
        kind: 'single',
        options: [
          { id: 'a', text: 'Your email account', correct: true },
          { id: 'b', text: 'A forum you rarely use', correct: false },
          { id: 'c', text: 'A news site subscription', correct: false },
        ],
      },
      {
        id: 'q2',
        prompt: 'Why can a passkey not be phished in the usual way?',
        kind: 'single',
        options: [
          { id: 'a', text: 'It is longer than a password', correct: false },
          { id: 'b', text: 'It only works on the genuine website it was created for', correct: true },
          { id: 'c', text: 'It changes every 30 seconds', correct: false },
        ],
      },
      {
        id: 'q3',
        prompt: 'Which of these are common phishing red flags? Select all that apply.',
        kind: 'multiple',
        options: [
          { id: 'a', text: 'Pressure to act within hours', correct: true },
          { id: 'b', text: 'A request for a one-time code', correct: true },
          { id: 'c', text: 'A message you were expecting from a known address', correct: false },
          { id: 'd', text: 'A link to a lookalike domain', correct: true },
        ],
      },
      {
        id: 'q4',
        prompt: 'Someone calls claiming to be support and asks for the code you just received. What do you do?',
        kind: 'single',
        options: [
          { id: 'a', text: 'Read it out so they can help', correct: false },
          { id: 'b', text: 'Hang up and contact the company through its official app or site', correct: true },
          { id: 'c', text: 'Send it by text message instead', correct: false },
        ],
      },
      {
        id: 'q5',
        prompt: 'What is the main problem with reusing a password?',
        kind: 'single',
        options: [
          { id: 'a', text: 'A leak on one site exposes your other accounts', correct: true },
          { id: 'b', text: 'Websites reject reused passwords', correct: false },
          { id: 'c', text: 'It slows down your login', correct: false },
        ],
      },
      {
        id: 'q6',
        prompt: 'A message has a link you are unsure about. What is the safest way to check it?',
        kind: 'single',
        options: [
          { id: 'a', text: 'Click it quickly and close the page', correct: false },
          { id: 'b', text: 'Open the official app or type the address yourself', correct: true },
          { id: 'c', text: 'Forward it to friends to ask', correct: false },
        ],
      },
    ],
  },
  assignment: null,
  completion: { requireAllLessons: true, requireQuiz: true, requireAssignment: false },
  credential: {
    enabled: true,
    title: 'Staying Safe Online',
    criteria: 'Completed all lessons and scored at least 75% on a randomised assessment.',
  },
};

export const phishingDefense: CourseContentInput = {
  description:
    'Take what you learned in Staying Safe Online and apply it to real messages. You will finish by analysing a suspicious message and writing up how you would verify it.',
  outcomes: ['Break down a suspicious message into concrete red flags', 'Describe a safe verification routine', 'Write a short, useful incident note'],
  prerequisitesText: 'Complete "Staying Safe Online" first.',
  instructorName: 'Bayo Adeyemi',
  modules: [
    {
      id: 'mod_analysis',
      title: 'Analysing messages',
      lessons: [
        {
          id: 'les_headers',
          title: 'Reading the sender, not the display name',
          kind: 'text',
          estimatedMinutes: 8,
          body: `Email clients show a friendly display name first. The part that matters is the address and the domain after the @.

- \`Support Team <help@yourbank.com>\` is plausible.
- \`Your Bank <alerts@secure-yourbank-verify.io>\` is not, even if the logo looks right.

Check links by hovering (desktop) or long-pressing (mobile) before opening them. Look at the **domain**, read right to left from the first single slash.`,
        },
        {
          id: 'les_verify',
          title: 'A verification routine you can repeat',
          kind: 'text',
          estimatedMinutes: 6,
          body: `When a message asks you to act:

1. **Pause.** Urgency is the attacker's friend.
2. **Verify out of band.** Use a phone number or app you already trust, not one in the message.
3. **Report it.** Most communities and companies have a place to forward suspicious messages.
4. **Write it down.** A two-line note helps others spot the same attempt.`,
        },
      ],
    },
  ],
  quiz: {
    id: 'quiz_phish',
    title: 'Phishing scenarios',
    passPercent: 75,
    questionsPerAttempt: 4,
    maxAttempts: 3,
    cooldownMinutes: 0,
    questions: [
      {
        id: 'p1',
        prompt: 'Which part of an email address tells you who really sent it?',
        kind: 'single',
        options: [
          { id: 'a', text: 'The display name', correct: false },
          { id: 'b', text: 'The domain after the @', correct: true },
          { id: 'c', text: 'The subject line', correct: false },
        ],
      },
      {
        id: 'p2',
        prompt: 'What does "verify out of band" mean?',
        kind: 'single',
        options: [
          { id: 'a', text: 'Reply to the message to ask if it is real', correct: false },
          { id: 'b', text: 'Contact the sender through a channel you already trust', correct: true },
          { id: 'c', text: 'Wait a day before replying', correct: false },
        ],
      },
      {
        id: 'p3',
        prompt: 'Which link is most likely to be fake?',
        kind: 'single',
        options: [
          { id: 'a', text: 'https://accounts.google.com/signin', correct: false },
          { id: 'b', text: 'https://google.com.account-security.help/signin', correct: true },
          { id: 'c', text: 'https://www.google.com/', correct: false },
        ],
      },
      {
        id: 'p4',
        prompt: 'Which steps belong in a good verification routine? Select all that apply.',
        kind: 'multiple',
        options: [
          { id: 'a', text: 'Pause before acting', correct: true },
          { id: 'b', text: 'Use the phone number in the message', correct: false },
          { id: 'c', text: 'Report the message', correct: true },
          { id: 'd', text: 'Write a short note about it', correct: true },
        ],
      },
      {
        id: 'p5',
        prompt: 'A "community airdrop" asks you to connect your wallet and sign a message to claim. What is the safest response?',
        kind: 'single',
        options: [
          { id: 'a', text: 'Sign quickly before it runs out', correct: false },
          { id: 'b', text: "Check the community's official channels before connecting anything", correct: true },
          { id: 'c', text: 'Share it in the group chat', correct: false },
        ],
      },
    ],
  },
  assignment: {
    id: 'asg_analysis',
    title: 'Analyse a suspicious message',
    prompt: `Find a suspicious message you have received (email, SMS or DM), or use one from a public phishing archive. **Remove any personal information.**

Write up:

1. At least three red flags, each with a one-line explanation.
2. How you would verify whether it is genuine, step by step.
3. A two-line note you could post to warn others.

You can paste your write-up, link to a document, or attach a PDF or screenshot.`,
    allowLink: true,
    allowFile: true,
    rubric: [
      { id: 'c_flags', title: 'Identifies at least three red flags', description: 'Each flag is specific to the message, not generic.', required: true },
      { id: 'c_verify', title: 'Describes a safe verification routine', description: 'Uses an out-of-band channel and avoids links in the message.', required: true },
      { id: 'c_note', title: 'Clear warning note', description: 'Short, accurate and useful to others.', required: false },
    ],
  },
  completion: { requireAllLessons: true, requireQuiz: true, requireAssignment: true },
  credential: {
    enabled: true,
    title: 'Phishing Defense Practitioner',
    criteria: 'Completed all lessons, passed a randomised assessment, and had a practical message analysis approved by a reviewer.',
  },
};

export const incidentResponse: CourseContentInput = {
  description: 'What to do in the first hour after an account is compromised. Paid with course credits earned in Phishing Defense.',
  outcomes: ['Contain a compromised account', 'Know who to notify and in what order'],
  prerequisitesText: '',
  instructorName: 'Ada Okafor',
  modules: [
    {
      id: 'mod_first_hour',
      title: 'The first hour',
      lessons: [
        {
          id: 'les_contain',
          title: 'Contain, then investigate',
          kind: 'text',
          estimatedMinutes: 9,
          body: `1. Change the password from a device you trust.
2. Sign out all other sessions.
3. Revoke app and wallet approvals you don't recognise.
4. Tell the people who might be targeted next.

Only then start working out how it happened.`,
        },
      ],
    },
  ],
  quiz: null,
  assignment: null,
  completion: { requireAllLessons: true, requireQuiz: false, requireAssignment: false },
  credential: { enabled: true, title: 'Incident Response: First Hour', criteria: '' },
};

export const spreadsheets: CourseContentInput = {
  description: 'Clean, share and chart community data without breaking anything.',
  outcomes: ['Structure a dataset so others can reuse it', 'Make a chart that answers one question'],
  prerequisitesText: '',
  instructorName: 'Open Data Collective',
  modules: [
    {
      id: 'mod_tidy',
      title: 'Tidy data',
      lessons: [
        {
          id: 'les_rows',
          title: 'One row, one thing',
          kind: 'text',
          estimatedMinutes: 5,
          body: 'Every row should describe one thing, and every column one property of it. Avoid merged cells and colour-as-data.',
        },
        {
          id: 'les_chart',
          title: 'Charts that answer a question',
          kind: 'text',
          estimatedMinutes: 6,
          body: 'Write the question first, then pick the chart. Comparisons suit bars, change over time suits lines.',
        },
      ],
    },
  ],
  quiz: null,
  assignment: null,
  completion: { requireAllLessons: true, requireQuiz: false, requireAssignment: false },
  credential: { enabled: true, title: 'Tidy Community Data', criteria: '' },
};
