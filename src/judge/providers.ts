import { z } from 'zod';
import { DomainError } from '@/domain/errors';
import type { ConflictEvent, JudgeVerdict, PartyRole, ProtocolType } from '@/domain/types';

export interface JudgeInput {
  conflictId: string;
  title: string;
  description: string;
  protocolType: ProtocolType;
  events: Array<{ id: string; party: PartyRole | null; type: string; content: string }>;
  concededBy: PartyRole | null;
}
export interface JudgeProvider {
  readonly name: string;
  evaluate(input: JudgeInput): Promise<unknown>;
}

const score = z.number().min(0).max(100);
const confidence = z.number().min(0).max(1);
const scoreSet = z.object({
  logic: score,
  evidence: score,
  rebuttal: score,
  responsiveness: score,
  overall: score,
});
export const debateVerdictSchema = z.object({
  protocolType: z.literal('debate'),
  winner: z.enum(['party_a', 'party_b', 'tie', 'insufficient_information']),
  confidence,
  scores: z.object({ partyA: scoreSet, partyB: scoreSet }),
  summary: z.string().min(1).max(5000),
  decidingPoints: z.array(z.string()),
  partyAStrengths: z.array(z.string()),
  partyBStrengths: z.array(z.string()),
  partyAWeaknesses: z.array(z.string()),
  partyBWeaknesses: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  citedEventIds: z.array(z.string()),
});
export const persuasionVerdictSchema = z.object({
  protocolType: z.literal('persuasion'),
  outcome: z.enum([
    'persuaded',
    'partially_persuaded',
    'not_persuaded',
    'target_conceded',
    'insufficient_information',
  ]),
  confidence,
  persuasionScore: score,
  summary: z.string().min(1).max(5000),
  strongestArguments: z.array(z.string()),
  unresolvedConcerns: z.array(z.string()),
  concessions: z.array(z.string()),
  citedEventIds: z.array(z.string()),
});
const verdictSchema = z.discriminatedUnion('protocolType', [
  debateVerdictSchema,
  persuasionVerdictSchema,
]);

export function validateVerdict(value: unknown, input: JudgeInput): JudgeVerdict {
  const verdict = verdictSchema.parse(value);
  if (verdict.protocolType !== input.protocolType)
    throw new Error('Verdict protocol does not match conflict.');
  const valid = new Set(input.events.map((e) => e.id));
  if (verdict.citedEventIds.some((id) => !valid.has(id)))
    throw new Error('Verdict cites an unknown event.');
  return verdict;
}

export class MockJudgeProvider implements JudgeProvider {
  readonly name = 'mock';
  async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
    const cited = input.events
      .filter((e) => e.party)
      .slice(-4)
      .map((e) => e.id);
    if (input.protocolType === 'persuasion') {
      const target =
        input.concededBy && input.concededBy !== 'party_a'
          ? 'target_conceded'
          : 'partially_persuaded';
      return {
        protocolType: 'persuasion',
        outcome: target,
        confidence: 0.78,
        persuasionScore: 74,
        summary:
          'The persuader addressed the central practical concern while some implementation questions remain.',
        strongestArguments: [
          'Connected the proposal to the target’s stated priorities.',
          'Answered the principal cost objection with a concrete alternative.',
        ],
        unresolvedConcerns: ['Long-term implementation evidence remains limited.'],
        concessions: input.concededBy
          ? ['The target explicitly conceded.']
          : ['Both parties accepted that access and reliability matter.'],
        citedEventIds: cited,
      };
    }
    const conceded = input.concededBy;
    const winner = conceded ? (conceded === 'party_a' ? 'party_b' : 'party_a') : 'party_a';
    return {
      protocolType: 'debate',
      winner,
      confidence: 0.78,
      scores: {
        partyA: { logic: 84, evidence: 76, rebuttal: 86, responsiveness: 88, overall: 84 },
        partyB: { logic: 80, evidence: 82, rebuttal: 78, responsiveness: 81, overall: 80 },
      },
      summary: conceded
        ? 'One party conceded; the assessment records the other party as prevailing.'
        : 'Party A presented the more complete case, particularly by answering the funding objection without abandoning the access goal.',
      decidingPoints: [
        'Party A directly addressed the strongest counterargument.',
        'Party B supplied useful evidence but left the alternative funding proposal underexplored.',
      ],
      partyAStrengths: ['Clear causal reasoning', 'Responsive rebuttal'],
      partyBStrengths: ['Strong operational caution', 'Relevant evidence'],
      partyAWeaknesses: ['Limited implementation detail'],
      partyBWeaknesses: ['Did not fully answer the proposed funding mechanism'],
      unresolvedQuestions: [
        'How would eligibility be verified?',
        'What revenue mix would preserve service frequency?',
      ],
      citedEventIds: cited,
    };
  }
}

export class LLMJudgeProvider implements JudgeProvider {
  readonly name = 'llm';
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}
  async evaluate(input: JudgeInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: 'system',
              content:
                'You are a neutral ResolveRoom Judge. Return only JSON matching the supplied protocol schema. A verdict is advisory, not objective truth. Evaluate only the anonymized case record.',
            },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      });
      if (!response.ok)
        throw new DomainError('JUDGE_FAILED', `Judge provider returned ${response.status}.`, 502);
      const data: any = await response.json();
      const text =
        data.output_text ??
        data.output?.flatMap((x: any) => x.content ?? []).find((x: any) => x.type === 'output_text')
          ?.text;
      if (typeof text !== 'string')
        throw new DomainError('JUDGE_FAILED', 'Judge provider returned no structured output.', 502);
      return JSON.parse(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function judgeInputFromEvents(
  conflict: { id: string; title: string; description: string; protocolType: ProtocolType },
  events: ConflictEvent[],
): JudgeInput {
  return {
    conflictId: conflict.id,
    title: conflict.title,
    description: conflict.description,
    protocolType: conflict.protocolType,
    events: events
      .filter(
        (e) =>
          e.visibility === 'case' || e.visibility === 'observer' || e.visibility === 'judge_only',
      )
      .map((e) => ({
        id: e.id,
        party: e.partyRole,
        type: e.eventType,
        content: typeof e.payload.content === 'string' ? e.payload.content : '',
      })),
    concededBy: events.findLast((e) => e.eventType === 'party_conceded')?.partyRole ?? null,
  };
}
