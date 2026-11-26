import { describe, expect, it } from 'vitest';
import {
  StudyStore,
  aggregate,
  answersToCsv,
  emptySession,
  participantCode,
  quizRatio,
  sanitizeArchive,
  sanitizeSession,
  sanitizeSurvey,
  sessionsToCsv
} from '../../src/study/store';
import type { StudySession, SurveyAnswers } from '../../src/study/types';

/**
 * The study store is the instrument: if a participant row can be silently corrupted, the
 * comparison between the three conditions is worthless. These tests pin the guarantees the
 * research depends on — sanitisation of anything read back, a stable denominator for the quiz
 * ratio, and exports that stay valid CSV/JSON.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const SURVEY: SurveyAnswers = {
  difficulty: 4,
  difference: 5,
  effectiveness: 4,
  preference: 'more',
  recommend: 8,
  comment: 'the nucleus was the clearest part'
};

function session(overrides: Partial<StudySession> = {}): StudySession {
  return { ...emptySession('en', 1_000), participantId: 'CL-ABC234', mode: 'hands', ...overrides };
}

describe('participant codes', () => {
  it('are unambiguous and prefixed', () => {
    for (let i = 0; i < 50; i++) {
      const code = participantCode();
      expect(code).toMatch(/^CL-[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});

describe('sanitizeSession', () => {
  it('rejects a payload from a newer schema instead of merging it', () => {
    expect(sanitizeSession({ ...session(), version: 99 })).toBeNull();
  });

  it('rejects a session without a participant id', () => {
    expect(sanitizeSession({ ...session(), participantId: '' })).toBeNull();
    expect(sanitizeSession(null)).toBeNull();
  });

  it('drops an unknown mode but keeps the rest of the row', () => {
    const clean = sanitizeSession({ ...session(), mode: 'telepathy' });
    expect(clean?.mode).toBeNull();
    expect(clean?.participantId).toBe('CL-ABC234');
  });

  it('clamps out-of-range numbers and truncates the comment', () => {
    const clean = sanitizeSession({
      ...session(),
      readingSeconds: -50,
      quizTotal: 10_000,
      survey: { ...SURVEY, difficulty: 42, recommend: 99, comment: 'x'.repeat(5000) }
    });
    expect(clean?.readingSeconds).toBe(0);
    expect(clean?.quizTotal).toBe(1000);
    expect(clean?.survey?.difficulty).toBe(5);
    expect(clean?.survey?.recommend).toBe(10);
    expect(clean?.survey?.comment).toHaveLength(2000);
  });

  it('rejects a survey with an unknown preference', () => {
    expect(sanitizeSurvey({ ...SURVEY, preference: 'maybe' })).toBeNull();
  });

  it('drops malformed quiz answers but keeps the well-formed ones', () => {
    const clean = sanitizeSession({
      ...session(),
      quiz: [
        { questionId: 'q1', correct: true, ms: 1200 },
        { questionId: 'q2', correct: 'yes', ms: 10 },
        null,
        { questionId: 'q3', correct: false, ms: -5 }
      ]
    });
    expect(clean?.quiz).toHaveLength(2);
    expect(clean?.quiz[1].ms).toBe(0);
  });
});

describe('sanitizeArchive', () => {
  it('keeps only valid sessions', () => {
    const archive = sanitizeArchive([session(), { version: 99 }, null, session({ mode: 'text' })]);
    expect(archive).toHaveLength(2);
    expect(archive[1].mode).toBe('text');
  });

  it('is empty for a non-array', () => {
    expect(sanitizeArchive({})).toEqual([]);
  });
});

describe('quizRatio', () => {
  it('uses the questions served as the denominator, not the answers given', () => {
    const ratio = quizRatio(
      session({ quizTotal: 10, quiz: [{ questionId: 'q1', correct: true, ms: 1 }] })
    );
    expect(ratio).toBe(0.1);
  });

  it('falls back to the answer count when no total was stored', () => {
    const ratio = quizRatio(
      session({ quizTotal: 0, quiz: [{ questionId: 'q1', correct: true, ms: 1 }] })
    );
    expect(ratio).toBe(1);
  });

  it('is null when nothing was asked', () => {
    expect(quizRatio(session({ quizTotal: 0, quiz: [] }))).toBeNull();
  });
});

describe('aggregate', () => {
  it('reports one row per mode, in a fixed order', () => {
    const rows = aggregate([session({ mode: 'text' }), session({ mode: 'hands' })]);
    expect(rows.map((r) => r.mode)).toEqual(['hands', 'mouse', 'text']);
    expect(rows.map((r) => r.participants)).toEqual([1, 0, 1]);
  });

  it('averages only the participants who actually answered', () => {
    const rows = aggregate([
      session({
        mode: 'hands',
        quizTotal: 10,
        quiz: [
          { questionId: 'a', correct: true, ms: 1 },
          { questionId: 'b', correct: false, ms: 1 }
        ],
        survey: SURVEY
      }),
      session({ mode: 'hands', quizTotal: 0, quiz: [], survey: null })
    ]);
    const hands = rows[0];
    expect(hands.participants).toBe(2);
    expect(hands.meanQuizRatio).toBe(0.1);
    expect(hands.meanDifficulty).toBe(4);
    expect(hands.preferenceCounts.more).toBe(1);
  });

  it('is null rather than NaN for a mode with no data', () => {
    const mouse = aggregate([])[1];
    expect(mouse.meanQuizRatio).toBeNull();
    expect(mouse.meanReadingSeconds).toBeNull();
    expect(mouse.meanRecommend).toBeNull();
  });
});

describe('exports', () => {
  it('writes a header row and one row per participant', () => {
    const csv = sessionsToCsv([session({ survey: SURVEY })]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('participant_id');
    expect(lines[0]).toContain('effectiveness_1_worse_5_better');
    expect(lines[1]).toContain('CL-ABC234');
    expect(lines[1]).toContain('"more"');
  });

  it('keeps a multi-line comment inside one quoted cell', () => {
    const csv = sessionsToCsv([session({ survey: { ...SURVEY, comment: 'line one\nline two' } })]);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"line one line two"');
  });

  it('escapes quotes in free text', () => {
    const csv = sessionsToCsv([session({ survey: { ...SURVEY, comment: 'say "hi"' } })]);
    expect(csv).toContain('"say ""hi"""');
  });

  it('leaves survey columns empty for an unfinished session', () => {
    const csv = sessionsToCsv([session({ endedAt: null, survey: null })]);
    expect(csv).toContain('"CL-ABC234","hands","en"');
    expect(csv).not.toContain('"much-more"');
  });

  it('writes one row per answered question', () => {
    const csv = answersToCsv([
      session({
        quiz: [
          { questionId: 'q1', correct: true, ms: 1500 },
          { questionId: 'q2', correct: false, ms: 500 }
        ]
      })
    ]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('q1');
    expect(lines[2]).toContain('0.5');
  });
});

describe('StudyStore', () => {
  it('starts a session lazily and tags it with the mode', () => {
    const store = new StudyStore(new MemoryStorage());
    expect(store.hasSession).toBe(false);
    expect(store.mode).toBeNull();
    store.current('fr');
    store.setMode('mouse');
    expect(store.mode).toBe('mouse');
    expect(store.hasSession).toBe(true);
  });

  it('archives a finished session and re-arms a fresh participant code', () => {
    const store = new StudyStore(new MemoryStorage());
    store.current('en');
    store.setMode('text');
    const closed = store.finish(2_000);
    expect(closed?.endedAt).toBe(2_000);
    expect(store.hasSession).toBe(false);
    expect(store.all()).toHaveLength(1);
    const next = store.current('en');
    expect(next.participantId).not.toBe(closed?.participantId);
    expect(next.mode).toBeNull();
  });

  it('persists to storage and reads back a sanitised copy', () => {
    const storage = new MemoryStorage();
    const store = new StudyStore(storage);
    store.current('en');
    store.setMode('hands');
    store.addReading(120);
    store.recordQuiz([{ questionId: 'q1', correct: true, ms: 900 }], 10);
    store.recordSurvey(SURVEY);
    store.finish(5_000);

    const reopened = new StudyStore(storage);
    expect(reopened.all()).toHaveLength(1);
    const [row] = reopened.all();
    expect(row.mode).toBe('hands');
    expect(row.readingSeconds).toBe(120);
    expect(quizRatio(row)).toBe(0.1);
    expect(row.survey?.preference).toBe('more');
  });

  it('ignores a non-positive reading delta', () => {
    const store = new StudyStore(new MemoryStorage());
    store.current('en');
    store.addReading(0);
    store.addReading(-10);
    expect(store.all()[0].readingSeconds).toBe(0);
  });

  it('clears both the session and the archive', () => {
    const storage = new MemoryStorage();
    const store = new StudyStore(storage);
    store.current('en');
    store.finish(1_000);
    store.clear();
    expect(store.all()).toEqual([]);
    expect(new StudyStore(storage).all()).toEqual([]);
  });

  it('keeps working when storage is unavailable', () => {
    const store = new StudyStore(null);
    store.current('en');
    store.setMode('text');
    expect(store.mode).toBe('text');
    expect(store.exportCsv()).toContain('CL-');
  });

  it('survives a corrupted payload in storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('celly:v03:session', '{not json');
    storage.setItem('celly:v03:archive', '{"nope":true}');
    const store = new StudyStore(storage);
    expect(store.all()).toEqual([]);
    store.current('en');
    expect(store.hasSession).toBe(true);
  });
});