import { WorkersAIJudgeProvider, validateVerdict, type JudgeInput } from '../src/judge/providers';

// Deliberately opt-in: this uses real account quota, never real users' cases.
export default {
  async fetch(_request: Request, env: { AI: Ai }) {
    const input: JudgeInput = {
      conflictId: 'synthetic_judge_smoke',
      title: 'Choosing a team lunch venue',
      description:
        'Choose a venue for six people with a total budget of $120. All six must have a vegetarian option.',
      protocolType: 'debate',
      concededBy: null,
      events: [
        {
          id: 'evt_a1',
          party: 'party_a',
          type: 'argument_submitted',
          content: 'The garden cafe offers six vegetarian set lunches at $18 each, totaling $108.',
        },
        {
          id: 'evt_b1',
          party: 'party_b',
          type: 'argument_submitted',
          content: 'The rooftop has a better view, but costs $30 per person, totaling $180.',
        },
        {
          id: 'evt_b2',
          party: 'party_b',
          type: 'rebuttal_submitted',
          content: 'The rooftop exceeds the stated budget. I have no evidence of a group discount.',
        },
        {
          id: 'evt_a2',
          party: 'party_a',
          type: 'rebuttal_submitted',
          content: 'The cafe fits both constraints; the rooftop would require an extra $60.',
        },
        {
          id: 'evt_a3',
          party: 'party_a',
          type: 'closing_statement_submitted',
          content: 'Choose the cafe to honor the agreed budget and dietary requirement.',
        },
        {
          id: 'evt_b3',
          party: 'party_b',
          type: 'closing_statement_submitted',
          content: 'I still value the rooftop view, but cannot show it fits the agreed budget.',
        },
      ],
    };
    const provider = new WorkersAIJudgeProvider(env.AI);
    const verdict = validateVerdict(await provider.evaluate(input), input);
    if (verdict.protocolType !== 'debate' || verdict.citedEventIds.length === 0)
      throw new Error('Live Judge did not return a cited debate assessment.');
    return Response.json({
      passed: true,
      provider: provider.name,
      winner: verdict.winner,
      citation_count: verdict.citedEventIds.length,
      synthetic_data_only: true,
    });
  },
};
