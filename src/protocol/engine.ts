import { DomainError } from '@/domain/errors';
import type {
  AgentActionType,
  ConflictPhase,
  ConflictStatus,
  PartyRole,
  ProtocolType,
} from '@/domain/types';

export interface ProtocolSnapshot {
  protocolType: ProtocolType;
  status: ConflictStatus;
  phase: ConflictPhase;
  phaseIndex: number;
  turnIndex: number;
  firstSpeaker: PartyRole;
  persuaderParty: PartyRole | null;
  concededBy: PartyRole | null;
}

export interface ProtocolTransition {
  state: ProtocolSnapshot;
  phaseChanged: boolean;
  completed: boolean;
}

const phases: ConflictPhase[] = ['opening', 'rebuttal', 'closing'];
const otherParty = (party: PartyRole): PartyRole => (party === 'party_a' ? 'party_b' : 'party_a');

export class ConflictProtocol {
  constructor(readonly type: ProtocolType) {}

  create(firstSpeaker: PartyRole, persuaderParty: PartyRole | null = null): ProtocolSnapshot {
    if (this.type === 'persuasion' && !persuaderParty)
      throw new DomainError('VALIDATION_ERROR', 'Persuasion requires a persuader.', 422);
    return {
      protocolType: this.type,
      status: 'active',
      phase: 'opening',
      phaseIndex: 0,
      turnIndex: 0,
      firstSpeaker,
      persuaderParty,
      concededBy: null,
    };
  }

  getOrder(state: ProtocolSnapshot): [PartyRole, PartyRole] {
    const first = state.phaseIndex % 2 === 0 ? state.firstSpeaker : otherParty(state.firstSpeaker);
    return [first, otherParty(first)];
  }

  getCurrentSpeaker(state: ProtocolSnapshot): PartyRole | null {
    if (state.status !== 'active') return null;
    return this.getOrder(state)[state.turnIndex] ?? null;
  }

  getAllowedActions(state: ProtocolSnapshot, party: PartyRole): AgentActionType[] {
    if (state.status === 'paused') return [];
    if (state.status !== 'active' || this.getCurrentSpeaker(state) !== party) return [];
    const primary: AgentActionType =
      state.phase === 'opening'
        ? 'argument'
        : state.phase === 'rebuttal'
          ? 'rebuttal'
          : 'closing_statement';
    return [primary, 'evidence', 'concede'];
  }

  applyAction(
    state: ProtocolSnapshot,
    party: PartyRole,
    action: AgentActionType,
  ): ProtocolTransition {
    if (state.status === 'paused')
      throw new DomainError('CONFLICT_PAUSED', 'The conflict is paused.', 409);
    if (state.status === 'resolved' || state.status === 'judging')
      throw new DomainError('CONFLICT_RESOLVED', 'The conflict no longer accepts actions.', 409);
    if (state.status !== 'active')
      throw new DomainError(
        'INVALID_STATE',
        `Actions are not accepted while conflict is ${state.status}.`,
        409,
      );
    if (this.getCurrentSpeaker(state) !== party)
      throw new DomainError(
        'NOT_YOUR_TURN',
        `${party === 'party_a' ? 'Party B' : 'Party A'} currently owns the turn.`,
        409,
      );
    const allowed = this.getAllowedActions(state, party);
    if (!allowed.includes(action))
      throw new DomainError(
        'ACTION_NOT_ALLOWED',
        `${action} is not allowed during ${state.phase}.`,
        409,
      );
    if (action === 'concede')
      return {
        state: { ...state, status: 'judging', concededBy: party },
        phaseChanged: false,
        completed: true,
      };
    if (action === 'evidence')
      return { state: { ...state }, phaseChanged: false, completed: false };
    if (state.turnIndex === 0)
      return { state: { ...state, turnIndex: 1 }, phaseChanged: false, completed: false };
    if (state.phaseIndex === phases.length - 1)
      return { state: { ...state, status: 'judging' }, phaseChanged: false, completed: true };
    const phaseIndex = state.phaseIndex + 1;
    return {
      state: { ...state, phaseIndex, phase: phases[phaseIndex], turnIndex: 0 },
      phaseChanged: true,
      completed: false,
    };
  }

  pause(state: ProtocolSnapshot): ProtocolSnapshot {
    if (state.status !== 'active')
      throw new DomainError('INVALID_STATE', 'Only an active conflict can be paused.', 409);
    return { ...state, status: 'paused' };
  }

  resume(state: ProtocolSnapshot): ProtocolSnapshot {
    if (state.status !== 'paused')
      throw new DomainError('INVALID_STATE', 'Only a paused conflict can be resumed.', 409);
    return { ...state, status: 'active' };
  }
}

export class DebateProtocol extends ConflictProtocol {
  constructor() {
    super('debate');
  }
}
export class PersuasionProtocol extends ConflictProtocol {
  constructor() {
    super('persuasion');
  }
}
export const protocolFor = (type: ProtocolType): ConflictProtocol =>
  type === 'debate' ? new DebateProtocol() : new PersuasionProtocol();
