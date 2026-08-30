import { describe, expect, it } from 'vitest';
import { DebateProtocol, PersuasionProtocol } from '@/protocol/engine';
import { DomainError } from '@/domain/errors';

describe('DebateProtocol', () => {
  it.each([3, 4, 5, 10])(
    'honors %i rounds, including alternating intermediate rebuttals',
    (rounds) => {
      const protocol = new DebateProtocol();
      let state = protocol.create('party_b', null, rounds);
      for (let round = 0; round < rounds; round += 1) {
        expect(state.phaseIndex).toBe(round);
        expect(state.phase).toBe(
          round === 0 ? 'opening' : round === rounds - 1 ? 'closing' : 'rebuttal',
        );
        expect(protocol.getCurrentSpeaker(state)).toBe(round % 2 === 0 ? 'party_b' : 'party_a');
        for (let turn = 0; turn < 2; turn += 1) {
          const party = protocol.getCurrentSpeaker(state)!;
          state = protocol.applyAction(
            state,
            party,
            protocol.getAllowedActions(state, party)[0],
          ).state;
        }
        expect(state.status).toBe(round === rounds - 1 ? 'judging' : 'active');
      }
    },
  );
  it.each([0, 2, 11, 3.5, NaN])('rejects invalid round count %s', (rounds) => {
    expect(() => new DebateProtocol().create('party_a', null, rounds)).toThrow();
  });
  it('uses the selected first speaker and alternates phase order', () => {
    const protocol = new DebateProtocol();
    let state = protocol.create('party_b');
    expect(protocol.getCurrentSpeaker(state)).toBe('party_b');
    state = protocol.applyAction(state, 'party_b', 'argument').state;
    expect(protocol.getCurrentSpeaker(state)).toBe('party_a');
    const transition = protocol.applyAction(state, 'party_a', 'argument');
    expect(transition.phaseChanged).toBe(true);
    expect(transition.state.phase).toBe('rebuttal');
    expect(protocol.getCurrentSpeaker(transition.state)).toBe('party_a');
  });

  it('rejects the wrong party and invalid phase actions', () => {
    const protocol = new DebateProtocol();
    const state = protocol.create('party_a');
    expect(() => protocol.applyAction(state, 'party_b', 'argument')).toThrowError(DomainError);
    expect(() => protocol.applyAction(state, 'party_a', 'rebuttal')).toThrowError(/not allowed/i);
  });

  it('allows evidence without consuming a turn', () => {
    const protocol = new DebateProtocol();
    const state = protocol.create('party_a');
    const result = protocol.applyAction(state, 'party_a', 'evidence');
    expect(result.state).toEqual(state);
    expect(protocol.getCurrentSpeaker(result.state)).toBe('party_a');
  });

  it('completes after opening, rebuttal and closing', () => {
    const protocol = new DebateProtocol();
    let state = protocol.create('party_a');
    const actions = [
      'argument',
      'argument',
      'rebuttal',
      'rebuttal',
      'closing_statement',
      'closing_statement',
    ] as const;
    for (const action of actions) {
      const speaker = protocol.getCurrentSpeaker(state)!;
      state = protocol.applyAction(state, speaker, action).state;
    }
    expect(state.status).toBe('judging');
    expect(protocol.getCurrentSpeaker(state)).toBeNull();
    expect(() => protocol.applyAction(state, 'party_a', 'closing_statement')).toThrowError(
      /no longer accepts/i,
    );
  });

  it('supports pause/resume and concession', () => {
    const protocol = new DebateProtocol();
    const active = protocol.create('party_a');
    const paused = protocol.pause(active);
    expect(protocol.getAllowedActions(paused, 'party_a')).toEqual([]);
    expect(() => protocol.applyAction(paused, 'party_a', 'argument')).toThrowError(/paused/i);
    const resumed = protocol.resume(paused);
    const completed = protocol.applyAction(resumed, 'party_a', 'concede');
    expect(completed.completed).toBe(true);
    expect(completed.state.concededBy).toBe('party_a');
  });
});

describe('PersuasionProtocol', () => {
  it('requires a persuader and permits a target concession', () => {
    const protocol = new PersuasionProtocol();
    expect(() => protocol.create('party_a')).toThrowError(/requires a persuader/i);
    const state = protocol.create('party_b', 'party_a');
    const result = protocol.applyAction(state, 'party_b', 'concede');
    expect(result.state.status).toBe('judging');
    expect(result.state.concededBy).toBe('party_b');
  });
});
