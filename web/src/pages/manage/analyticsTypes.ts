export interface Analytics {
  summary: {
    members: number;
    learners: number;
    memberEnrollmentRate: number;
    returningLearners: number;
    enrollments: number;
    completions: number;
    completionRate: number;
    enrollments30d: number;
    completions30d: number;
  };
  assessments: {
    quizAttempts: number;
    quizPassRate: number;
    averageQuizScore: number;
    submissionsApproved: number;
    submissionsSentBack: number;
    flaggedDuplicates: number;
  };
  reviews: { open: number; averageReviewHours: number; oldestOpenHours: number };
  rewards: {
    pointsPaid: number;
    creditsPaid: number;
    committed: number;
    unfunded: number;
    rejected: number;
    costPerCompletion: { points: number; courseCredits: number };
  };
  integrity: {
    appealsOpen: number;
    appealsUpheld: number;
    appealsOverturned: number;
    credentialsActive: number;
    credentialsRevoked: number;
  };
  courses: {
    id: string;
    title: string;
    status: string;
    enrollments: number;
    completions: number;
    completionRate: number;
    avgDaysToComplete: number;
    avgQuizScore: number;
  }[];
  weekly: { week: string; enrollments: number; completions: number }[];
}
