import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { post } from '../../api';
import { ErrorNotice, formatDate } from '../../components/ui';
import type { QuizAttempt, QuizResult } from '../../types';
import { usePlayer } from './Player';

export function QuizPage() {
  const { view, refresh } = usePlayer();
  const quiz = view.quiz;
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const start = useMutation({
    mutationFn: () => post<{ attempt: QuizAttempt }>(`/api/courses/${view.course.id}/quiz/attempts`),
    onSuccess: (data) => {
      setAttempt(data.attempt);
      setAnswers({});
      setResult(null);
    },
  });
  const submit = useMutation({
    mutationFn: () => post<{ result: QuizResult }>(`/api/quiz-attempts/${attempt!.id}/submit`, { answers }),
    onSuccess: async (data) => {
      setResult(data.result);
      setAttempt(null);
      await refresh();
    },
  });

  if (!quiz) return <p>This course has no quiz.</p>;
  const locked = view.access.state !== 'granted';
  const exhausted = !quiz.passed && quiz.attemptsUsed >= quiz.maxAttempts;
  const cooling = quiz.cooldownUntil && new Date(quiz.cooldownUntil) > new Date();

  if (result) {
    return (
      <div className="card">
        <span className={`badge ${result.passed ? 'ok' : 'bad'}`}>{result.passed ? 'Passed' : 'Not passed yet'}</span>
        <h1 style={{ marginTop: 10 }}>{result.scorePercent}%</h1>
        <p>
          You answered {result.correct} of {result.total} questions correctly. The pass mark is {result.passPercent}%.
        </p>
        {result.passed ? (
          <div className="row">
            {result.courseCompleted && result.credentialPublicId ? (
              <Link className="btn primary" to={`/verify/${result.credentialPublicId}`}>
                View your credential
              </Link>
            ) : (
              <Link className="btn primary" to={`/learn/${view.course.id}`}>
                Back to course
              </Link>
            )}
          </div>
        ) : result.attemptsRemaining > 0 ? (
          <>
            <p className="muted">
              {result.attemptsRemaining} {result.attemptsRemaining === 1 ? 'attempt' : 'attempts'} left. Questions are drawn at random,
              so reviewing the lessons helps more than memorising answers.
            </p>
            <div className="row">
              <Link className="btn" to={`/learn/${view.course.id}`}>
                Review lessons
              </Link>
              <button className="btn primary" onClick={() => start.mutate()} disabled={start.isPending}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <p className="notice warn">You've used all your attempts. Contact the community if you think you need another.</p>
        )}
        {start.error && <ErrorNotice error={start.error} />}
      </div>
    );
  }

  if (attempt) {
    const unanswered = attempt.questions.filter((q) => !(answers[q.id]?.length)).length;
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (unanswered && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
          submit.mutate();
        }}
      >
        <h1>{quiz.title}</h1>
        <p className="muted small">
          {attempt.questions.length} questions · pass mark {quiz.passPercent}% · attempt {quiz.attemptsUsed + 1} of {quiz.maxAttempts}
        </p>
        {attempt.questions.map((q, i) => (
          <fieldset key={q.id}>
            <legend>
              {i + 1}. {q.prompt}
              {q.kind === 'multiple' && <span className="muted small"> (select all that apply)</span>}
            </legend>
            {q.options.map((o) => {
              const checked = answers[q.id]?.includes(o.id) ?? false;
              return (
                <label key={o.id} className="option">
                  <input
                    type={q.kind === 'single' ? 'radio' : 'checkbox'}
                    name={q.id}
                    checked={checked}
                    onChange={(e) =>
                      setAnswers((prev) => {
                        const current = prev[q.id] ?? [];
                        const next =
                          q.kind === 'single' ? [o.id] : e.target.checked ? [...current, o.id] : current.filter((x) => x !== o.id);
                        return { ...prev, [q.id]: next };
                      })
                    }
                  />
                  <span>{o.text}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
        <div className="row end">
          <button className="btn primary" type="submit" disabled={submit.isPending}>
            {submit.isPending ? 'Grading…' : 'Submit answers'}
          </button>
        </div>
        {submit.error && <ErrorNotice error={submit.error} />}
      </form>
    );
  }

  return (
    <div className="card">
      <h1>{quiz.title}</h1>
      <ul className="small">
        <li>{quiz.questionsPerAttempt} questions, drawn at random from a larger bank</li>
        <li>Pass mark: {quiz.passPercent}%</li>
        <li>
          Attempts: {quiz.attemptsUsed} of {quiz.maxAttempts} used
        </li>
        <li>Graded on the server. Answers are not shown afterwards, so retakes stay fair.</li>
      </ul>
      {quiz.passed ? (
        <p className="notice ok">
          You passed with {quiz.bestScore}%. {view.stage === 'completed' ? '' : 'Finish the remaining requirements to complete the course.'}
        </p>
      ) : exhausted ? (
        <p className="notice warn">You've used all your attempts. Contact the community if you think you need another.</p>
      ) : cooling ? (
        <p className="notice warn">You can try again after {formatDate(quiz.cooldownUntil!, true)}.</p>
      ) : (
        <button className="btn primary" disabled={locked || start.isPending} onClick={() => start.mutate()}>
          {quiz.openAttemptId ? 'Resume attempt' : quiz.attemptsUsed > 0 ? 'Start another attempt' : 'Start the quiz'}
        </button>
      )}
      {start.error && <ErrorNotice error={start.error} />}
      {quiz.history.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Your attempts</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Score</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {quiz.history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.submittedAt, true)}</td>
                    <td className="num">{h.scorePercent}%</td>
                    <td>{h.passed ? <span className="badge ok">Passed</span> : <span className="badge">Not passed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
