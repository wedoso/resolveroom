import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Scale,
  Share2,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api';
import { copyText } from './clipboard';
import {
  AppShell,
  ConfirmDialog,
  Dialog,
  PageLoading,
  PrivacyNote,
  StatePanel,
  StatusBadge,
} from './components';
import { TranscriptList } from './pages';

type RoomData = {
  conflict: any;
  events: any[];
  brief: any;
  verdict: any;
  agents: any[];
  shareLinks: any[];
};
export function ConflictRoomPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const [data, setData] = useState<RoomData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('live');
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'offline'
  >('connecting');
  const [invite, setInvite] = useState<any>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'concede' | null>(null);
  const [newActivity, setNewActivity] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [conflict, events, brief, agents, shares] = await Promise.all([
        api<any>(`/conflicts/${id}`),
        api<any>(`/conflicts/${id}/events`),
        api<any>(`/conflicts/${id}/brief`),
        api<any>('/agents'),
        api<any>(`/conflicts/${id}/share-links`).catch(() => ({ share_links: [] })),
      ]);
      let verdict = null;
      if (conflict.status === 'resolved')
        verdict = await api<any>(`/conflicts/${id}/verdict`).catch(() => null);
      setData({
        conflict,
        events: events.events,
        brief: brief.brief,
        verdict: verdict?.verdict ?? null,
        agents: agents.agents,
        shareLinks: shares.share_links,
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conflict could not be loaded.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);
  useEffect(() => {
    if (!id) return;
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    const connect = () => {
      setConnection((current) => (current === 'connected' ? 'reconnecting' : current));
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}/api/v1/conflicts/${id}/stream`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = () => {
        const element = recordRef.current;
        const near = element
          ? element.scrollHeight - element.scrollTop - element.clientHeight < 140
          : true;
        if (!near) setNewActivity(true);
        void load();
      };
      socket.onclose = () => {
        setConnection(navigator.onLine ? 'reconnecting' : 'offline');
        retry = window.setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [id, load]);
  const createInvite = async () => {
    const value = await api<any>(`/conflicts/${id}/invite`, { method: 'POST', body: '{}' });
    setInvite(value.invite);
  };
  useEffect(() => {
    if (search.get('created') === '1' && data?.conflict.your_party === 'party_a' && !invite)
      void createInvite();
  }, [data?.conflict.your_party]);
  if (!data && !error)
    return (
      <AppShell>
        <PageLoading label="Opening the conflict room…" />
      </AppShell>
    );
  if (error)
    return (
      <AppShell>
        <main className="state-page">
          <StatePanel icon="error" title="This conflict is unavailable">
            <p>{error}</p>
            <Link className="button secondary" to="/dashboard">
              Back to dashboard
            </Link>
          </StatePanel>
        </main>
      </AppShell>
    );
  if (!data) return null;
  const c = data.conflict;
  const yours = c.parties.find((p: any) => p.role === c.your_party);
  const opponent = c.parties.find((p: any) => p.role !== c.your_party);
  const mutate = async (action: string) => {
    await api(`/conflicts/${id}/${action}`, { method: 'POST', body: '{}' });
    await load();
  };
  return (
    <AppShell>
      <main className="room-frame">
        <div className="room-breadcrumb">
          <Link to="/dashboard">
            <ArrowLeft />
            Conflicts
          </Link>
          <span className="mono">CASE / {c.id.slice(-8).toUpperCase()}</span>
        </div>
        <header className="room-header">
          <div>
            <div className="card-meta">
              <span className="mono">PRIVATE {c.protocol_type}</span>
              <StatusBadge status={c.status} />
            </div>
            <h1>{c.title}</h1>
            <p>{c.description}</p>
          </div>
          <div className="room-actions">
            <button className="button secondary" onClick={() => void createInvite()}>
              <Share2 />
              Invite
            </button>
            <div className="action-menu">
              <button className="button">
                <MoreHorizontal />
                Case actions
                <ChevronDown />
              </button>
              <div className="menu-popover">
                {c.status === 'active' && (
                  <button onClick={() => void mutate('pause')}>
                    <Pause />
                    Pause conflict
                  </button>
                )}
                {c.status === 'paused' && (
                  <button onClick={() => void mutate('resume')}>
                    <Play />
                    Resume conflict
                  </button>
                )}
                {c.status === 'active' && (
                  <button onClick={() => setConfirm('concede')}>
                    <Scale />
                    Concede
                  </button>
                )}{' '}
                {!['resolved', 'cancelled', 'expired'].includes(c.status) && (
                  <button className="danger-text" onClick={() => setConfirm('cancel')}>
                    <X />
                    Cancel conflict
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>
        <ParticipantStrip parties={c.parties} />
        <ProtocolProgress phase={c.phase} status={c.status} judgeAvailable={c.judge_available} />
        <div className="room-grid">
          <section className="record-column">
            <div className="room-tabs" role="tablist" aria-label="Conflict sections">
              {[
                'live',
                'transcript',
                'private brief',
                ...(c.judge_available ? ['verdict'] : []),
                'settings',
              ].map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value}
                </button>
              ))}
              <ConnectionState state={connection} />
            </div>
            {tab === 'live' || tab === 'transcript' ? (
              <div ref={recordRef} className="record-pane">
                <div className="record-title">
                  <div>
                    <h2>{tab === 'live' ? 'Live case record' : 'Complete transcript'}</h2>
                    <p>Append-only · {data.events.length} authorized events</p>
                  </div>
                  {tab === 'live' && (
                    <span className="live-label">
                      <Radio />
                      Following live
                    </span>
                  )}
                </div>
                {data.events.length ? (
                  <TranscriptList events={data.events} />
                ) : (
                  <StatePanel title="The case record is waiting">
                    <p>
                      Events will appear here once both participants are ready and the agents begin.
                    </p>
                  </StatePanel>
                )}
                {newActivity && (
                  <button
                    className="new-activity"
                    onClick={() => {
                      setNewActivity(false);
                      recordRef.current?.scrollTo({
                        top: recordRef.current.scrollHeight,
                        behavior: 'smooth',
                      });
                    }}
                  >
                    New activity ↓
                  </button>
                )}
              </div>
            ) : tab === 'private brief' ? (
              <BriefPanel id={id!} brief={data.brief} onSaved={load} />
            ) : tab === 'verdict' ? (
              <VerdictPanel record={data.verdict} status={c.status} />
            ) : (
              <SettingsPanel id={id!} data={data} load={load} />
            )}
          </section>
          <aside className="context-rail">
            <TurnCard conflict={c} />
            <AgentCard id={id!} party={yours} agents={data.agents} load={load} />
            <section className="rail-section">
              <div className="rail-label">
                PRIVATE BRIEF <span>{data.brief ? 'SAVED' : 'NOT STARTED'}</span>
              </div>
              <div className="rail-paper">
                <LockKeyhole />
                <div>
                  <strong>Only you and your authorized agent</strong>
                  <p>Never shared with {opponent.display_name} or their agent.</p>
                </div>
                <button className="text-link" onClick={() => setTab('private brief')}>
                  {data.brief ? 'Edit brief' : 'Add context'} →
                </button>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <Dialog
        open={Boolean(invite)}
        onClose={() => setInvite(null)}
        title="Invite the other participant"
        description="This single-purpose link expires in seven days and survives their sign-in redirect."
      >
        {invite && (
          <div className="invite-reveal">
            <label>
              Private invitation link
              <div>
                <input readOnly value={invite.url} />
                <button
                  className="icon-button"
                  onClick={() => void copyText(invite.url)}
                  aria-label="Copy invitation"
                >
                  <Copy />
                </button>
              </div>
            </label>
            <div className="privacy-note">
              <ShieldCheck />
              <p>
                Anyone with this link can accept the Party B seat once. Send it through a channel
                you trust.
              </p>
            </div>
            <button className="button wide" onClick={() => setInvite(null)}>
              Done
            </button>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel this conflict?"
        description="The case record will remain available to participants, but agents will no longer be able to act. This cannot be undone."
        confirmLabel="Cancel conflict"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => mutate('cancel')}
      />
      <ConfirmDialog
        open={confirm === 'concede'}
        title="Concede this conflict?"
        description={
          c.judge_available
            ? 'Your concession will become part of the shared case record and the Judge will prepare a short advisory assessment.'
            : 'Your concession will become part of the shared case record and end the structured exchange.'
        }
        confirmLabel={c.judge_available ? 'Concede and request verdict' : 'Concede conflict'}
        onClose={() => setConfirm(null)}
        onConfirm={() => mutate('concede')}
      />
    </AppShell>
  );
}

function ParticipantStrip({ parties }: { parties: any[] }) {
  return (
    <section className="participant-strip">
      {parties.map((p) => (
        <div key={p.id}>
          <span className={p.role === 'party_a' ? 'party-avatar a' : 'party-avatar b'}>
            {p.display_name.slice(0, 1)}
          </span>
          <div>
            <strong>{p.display_name}</strong>
            <small>
              {p.role.replace('_', ' ')} · {p.agent_bound ? 'AGENT BOUND' : 'NO AGENT'} ·{' '}
              {p.ready ? 'READY' : 'NOT READY'}
            </small>
          </div>
        </div>
      ))}
    </section>
  );
}
function ProtocolProgress({
  phase,
  status,
  judgeAvailable,
}: {
  phase: string | null;
  status: string;
  judgeAvailable: boolean;
}) {
  const items = ['opening', 'rebuttal', 'closing', ...(judgeAvailable ? ['verdict'] : [])];
  const current = status === 'resolved' && judgeAvailable ? 'verdict' : (phase ?? 'opening');
  const index = status === 'resolved' && !judgeAvailable ? items.length : items.indexOf(current);
  return (
    <section className="protocol-progress" aria-label="Protocol progress">
      {items.map((item, i) => (
        <div className={i < index ? 'complete' : i === index ? 'current' : ''} key={item}>
          <span>{i < index ? <Check /> : i + 1}</span>
          <strong>{item}</strong>
        </div>
      ))}
    </section>
  );
}
function ConnectionState({ state }: { state: string }) {
  return (
    <span className={`connection ${state}`} aria-live="polite">
      {state === 'connected' ? (
        <>
          <i />
          Connected
        </>
      ) : state === 'offline' ? (
        <>
          <Unplug />
          Offline
        </>
      ) : (
        <>
          <RefreshCw className="spin" />
          {state}
        </>
      )}
    </span>
  );
}
function TurnCard({ conflict: c }: { conflict: any }) {
  const turn = c.current_turn;
  const party = turn ? c.parties.find((p: any) => p.id === turn.party_id) : null;
  return (
    <section className="rail-section">
      <div className="rail-label">CURRENT STATE</div>
      <div className="turn-card">
        {turn ? (
          <>
            <div>
              <span className={turn.party_role === 'party_a' ? 'party-avatar a' : 'party-avatar b'}>
                {party?.display_name.slice(0, 1)}
              </span>
              <span>
                <strong>{party?.display_name}’s agent</strong>
                <small>Owns the {c.phase} turn</small>
              </span>
              <i />
            </div>
            <hr />
            <small className="mono">ALLOWED ACTIONS</small>
            <p>{turn.allowed_actions.map((a: string) => a.replaceAll('_', ' ')).join(' · ')}</p>
          </>
        ) : (
          <>
            <Scale />
            <strong>
              {c.status === 'resolved'
                ? c.judge_available
                  ? 'Assessment complete'
                  : 'Exchange complete'
                : c.status === 'judging'
                  ? c.judge_available
                    ? 'Judge is evaluating'
                    : 'Exchange complete'
                  : c.status === 'briefing'
                    ? 'Waiting for both participants'
                    : c.status.replaceAll('_', ' ')}
            </strong>
            <p>No agent action is currently accepted.</p>
          </>
        )}
      </div>
    </section>
  );
}
function AgentCard({
  id,
  party,
  agents,
  load,
}: {
  id: string;
  party: any;
  agents: any[];
  load: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<any>(null);
  const [pairingError, setPairingError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const bind = async (agentId: string) => {
    setBusy(true);
    await api(`/conflicts/${id}/agent`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    });
    await load();
    setBusy(false);
  };
  const startPairing = async () => {
    setBusy(true);
    setPairingError('');
    setCopied(false);
    setCopiedRecovery(false);
    try {
      const value = await api<any>(`/conflicts/${id}/agent/pairings`, {
        method: 'POST',
        body: '{}',
      });
      setPairing(value);
      await load();
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Could not create a pairing code.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const pairingId = pairing?.pairing?.id;
    if (!pairingId || (pairing.pairing.status !== 'waiting' && party.runner?.online)) return;
    const refresh = async () => {
      try {
        const value = await api<any>(`/agent-pairings/${pairingId}`, { cache: 'no-store' });
        setPairing((current: any) => (current ? { ...current, pairing: value.pairing } : current));
        if (value.pairing.status === 'connected') await load();
      } catch {
        // The next poll can recover a transient network failure.
      }
    };
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [pairing?.pairing?.id, pairing?.pairing?.status, party.runner?.online, load]);
  const ready = async () => {
    setBusy(true);
    await api(`/conflicts/${id}/ready`, { method: 'POST', body: '{"ready":true}' });
    await load();
    setBusy(false);
  };
  return (
    <section className="rail-section">
      <div className="rail-label">
        YOUR REPRESENTATIVE{' '}
        <span className={`runner-label ${party.runner?.state ?? 'reconnect_required'}`}>
          {party.runner?.state === 'working'
            ? 'WORKING'
            : party.runner?.online
              ? 'RUNNER ONLINE'
              : party.runner?.state === 'reconnecting'
                ? 'RECONNECTING'
                : 'RECONNECT REQUIRED'}
        </span>
      </div>
      <div className={`agent-rail-card runner-${party.runner?.state ?? 'reconnect_required'}`}>
        <Bot />
        <div>
          <strong>
            {party.runner?.state === 'working'
              ? 'Runner is working'
              : party.runner?.online
                ? 'Runner is online'
                : party.runner?.state === 'reconnecting'
                  ? 'Runner is reconnecting'
                  : party.agent_bound
                    ? 'Reconnect your Runner'
                    : 'Connect your Runner'}
          </strong>
          <p>
            {party.runner?.state === 'working'
              ? 'A turn is being prepared locally. Private context stays on this authorized connection.'
              : party.runner?.online
                ? `Automatic turns are enabled${party.runner.device_name ? ` on ${party.runner.device_name}` : ''}. You may close this page.`
                : party.runner?.state === 'reconnecting'
                  ? 'The local service is retrying automatically. If it remains offline, use Reconnect Runner.'
                  : party.agent_bound
                    ? `The Agent identity is authorized, but no live Runner is available${party.runner?.last_seen_at ? ` (last seen ${new Date(party.runner.last_seen_at).toLocaleString()})` : ''}.`
                    : 'Send one short-lived instruction to Codex. It installs a local service that stays connected.'}
          </p>
        </div>
        {party.runner?.online ? (
          <>
            <button
              className="button secondary wide"
              disabled={party.ready || busy}
              onClick={() => void ready()}
            >
              {party.ready ? (
                <>
                  <Check />
                  Ready
                </>
              ) : busy ? (
                'Saving…'
              ) : (
                'I’m ready'
              )}
            </button>
            <button
              className="agent-developer-link"
              disabled={busy}
              onClick={() => void startPairing()}
            >
              Reconnect Runner →
            </button>
          </>
        ) : (
          <>
            <button className="button wide" disabled={busy} onClick={() => void startPairing()}>
              {busy ? <LoaderCircle className="spin" /> : <Link2 />}
              {party.agent_bound ? 'Reconnect Runner' : 'Connect Runner'}
            </button>
            {pairingError && (
              <p className="form-error" role="alert">
                {pairingError}
              </p>
            )}
            {agents.some((agent) => agent.status === 'active') && !party.agent_bound && (
              <details className="existing-agent-options">
                <summary>Use an existing agent</summary>
                <select
                  aria-label="Select an existing agent"
                  disabled={busy}
                  defaultValue=""
                  onChange={(event) => void bind(event.target.value)}
                >
                  <option value="" disabled>
                    Select agent…
                  </option>
                  {agents
                    .filter((agent) => agent.status === 'active')
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
              </details>
            )}
            <Link className="agent-developer-link" to="/agents">
              Developer options →
            </Link>
          </>
        )}
      </div>
      <Dialog
        open={Boolean(pairing)}
        onClose={() => setPairing(null)}
        title={
          pairing?.pairing?.status === 'connected' && party.runner?.online
            ? 'Runner online'
            : pairing?.pairing?.status === 'connected'
              ? 'Starting local Runner'
              : 'Connect your Runner'
        }
        description={
          pairing?.pairing?.status === 'connected' && party.runner?.online
            ? 'ResolveRoom can now push authorized turns to this computer automatically.'
            : pairing?.pairing?.status === 'connected'
              ? 'Authorization succeeded. Waiting for the local background service to report online.'
              : 'Copy one instruction into a Codex task. It uses Codex’s bundled runtime, pairs once, and installs a self-contained background Runner.'
        }
      >
        {pairing && (
          <div className="pairing-flow" aria-live="polite">
            <ol className="pairing-progress" aria-label="Pairing progress">
              <li className="done">1 · Code</li>
              <li className={pairing.pairing.status === 'waiting' ? 'current' : 'done'}>
                2 · Send
              </li>
              <li className={pairing.pairing.status === 'connected' ? 'done' : ''}>
                3 · Connected
              </li>
            </ol>
            {pairingError && (
              <p className="form-error" role="alert">
                {pairingError}
              </p>
            )}
            {pairing.pairing.status === 'connected' && party.runner?.online ? (
              <div className="pairing-success">
                <span>
                  <Check />
                </span>
                <h3>Runner is online</h3>
                <p>
                  {party.runner.device_name ?? pairing.pairing.client_name ?? 'This computer'}{' '}
                  connected{' '}
                  {pairing.pairing.claimed_at
                    ? new Date(pairing.pairing.claimed_at).toLocaleTimeString()
                    : 'just now'}
                  .
                </p>
                <button className="button wide" onClick={() => setPairing(null)}>
                  Continue briefing
                </button>
              </div>
            ) : pairing.pairing.status === 'connected' ? (
              <div className="pairing-success pending">
                <span>
                  <LoaderCircle className="spin" />
                </span>
                <h3>Authorization complete</h3>
                <p>
                  Codex is installing and starting the local Runner. This normally takes less than a
                  minute; the page will update automatically.
                </p>
                <p>
                  If Codex reported an installation or startup error, finish the setup with the
                  recovery instruction below. The credential is already stored, so this does not
                  need or consume another pairing code.
                </p>
                <button
                  className="button secondary wide"
                  onClick={async () => {
                    try {
                      await copyText(pairing.recovery_instruction);
                      setCopiedRecovery(true);
                    } catch (error) {
                      setPairingError(
                        error instanceof Error ? error.message : 'Could not copy the instruction.',
                      );
                    }
                  }}
                >
                  {copiedRecovery ? <Check /> : <Copy />}
                  {copiedRecovery
                    ? 'Recovery instruction copied'
                    : 'Copy Runner recovery instruction'}
                </button>
              </div>
            ) : pairing.pairing.status === 'waiting' ? (
              <>
                <div className="pairing-code">
                  <small>ONE-TIME PAIRING CODE</small>
                  <strong>{pairing.code}</strong>
                  <span>Expires {new Date(pairing.pairing.expires_at).toLocaleTimeString()}</span>
                </div>
                <button
                  className="button large wide"
                  onClick={async () => {
                    try {
                      await copyText(pairing.instruction);
                      setCopied(true);
                    } catch (error) {
                      setPairingError(
                        error instanceof Error ? error.message : 'Could not copy the instruction.',
                      );
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Instruction copied' : 'Copy one-time connection instruction'}
                </button>
                <div className="pairing-safety">
                  <ShieldCheck />
                  <p>
                    This code contains no long-lived credential. It works once, expires in ten
                    minutes, and installs a self-contained Runner that reconnects automatically
                    after restarts—even if the system Node.js installation is unavailable.
                  </p>
                </div>
                <p className="pairing-waiting">
                  <LoaderCircle className="spin" /> Waiting for Codex to connect…
                </p>
              </>
            ) : (
              <div className="pairing-expired">
                <AlertTriangle />
                <h3>This pairing code is no longer available</h3>
                <p>Generate a fresh single-use instruction and send that one to Codex.</p>
                <button className="button wide" onClick={() => void startPairing()}>
                  <RefreshCw /> Generate new code
                </button>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}

function BriefPanel({
  id,
  brief,
  onSaved,
}: {
  id: string;
  brief: any;
  onSaved: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      await api(`/conflicts/${id}/brief`, {
        method: 'PUT',
        body: JSON.stringify({
          goal: form.get('goal'),
          priorities: String(form.get('priorities') ?? '')
            .split('\n')
            .filter(Boolean),
          acceptableCompromises: String(form.get('compromises') ?? '')
            .split('\n')
            .filter(Boolean),
          privateNotes: form.get('notes'),
        }),
      });
      setSaved(true);
      setMessage('Private brief saved.');
      await onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="brief-panel">
      <div className="record-title">
        <div>
          <h2>Your private brief</h2>
          <p>Shape what your agent should prioritize without changing the shared case record.</p>
        </div>
        <span className={saved ? 'save-state' : 'save-state unsaved'}>
          {saved ? 'Saved' : 'Unsaved changes'}
        </span>
      </div>
      <PrivacyNote />
      <form onSubmit={(event) => void submit(event)} onChange={() => setSaved(false)}>
        <label>
          What outcome do you want?
          <textarea
            name="goal"
            rows={3}
            defaultValue={brief?.content.goal ?? ''}
            placeholder="Help the other party understand why…"
          />
        </label>
        <div className="brief-grid">
          <label>
            Priorities <small>One per line</small>
            <textarea
              name="priorities"
              rows={5}
              defaultValue={brief?.content.priorities?.join('\n') ?? ''}
            />
          </label>
          <label>
            Acceptable compromises <small>One per line</small>
            <textarea
              name="compromises"
              rows={5}
              defaultValue={brief?.content.acceptableCompromises?.join('\n') ?? ''}
            />
          </label>
        </div>
        <label>
          Private notes
          <textarea name="notes" rows={6} defaultValue={brief?.content.privateNotes ?? ''} />
        </label>
        {message && (
          <p
            className={message.includes('saved') ? 'form-success' : 'form-error'}
            aria-live="polite"
          >
            {message}
          </p>
        )}
        <button className="button" disabled={busy || saved}>
          {busy ? (
            <>
              <LoaderCircle className="spin" />
              Saving…
            </>
          ) : (
            'Save private brief'
          )}
        </button>
      </form>
    </div>
  );
}

function VerdictPanel({ record, status }: { record: any; status: string }) {
  if (!record)
    return (
      <div className="verdict-empty">
        <Scale />
        <span className="eyebrow">ADVISORY ASSESSMENT</span>
        <h2>
          {status === 'judging'
            ? 'The Judge is evaluating the case'
            : 'The verdict is not available yet'}
        </h2>
        <p>
          {status === 'judging'
            ? 'The structured case record is being validated. You can close this page and return later.'
            : 'The Judge begins automatically after the protocol completes or a party concedes.'}
        </p>
      </div>
    );
  const v = record.verdict;
  return (
    <div className="verdict-panel">
      <div className="verdict-hero">
        <span className="eyebrow">AI-GENERATED ADVISORY ASSESSMENT</span>
        <StatusBadge status="resolved" />
        <h2>
          {v.protocolType === 'debate'
            ? v.winner === 'tie'
              ? 'The cases were evenly matched'
              : `${v.winner === 'party_a' ? 'Party A' : 'Party B'} presented the stronger case`
            : v.outcome.replaceAll('_', ' ')}
        </h2>
        <p>{v.summary}</p>
        <div className="confidence">
          <span>Confidence</span>
          <div>
            <i style={{ width: `${v.confidence * 100}%` }} />
          </div>
          <strong>{Math.round(v.confidence * 100)}%</strong>
        </div>
      </div>
      {v.decidingPoints && (
        <div className="verdict-section">
          <h3>Deciding points</h3>
          <ol>
            {v.decidingPoints.map((p: string, i: number) => (
              <li key={p}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}
      {v.scores && (
        <div className="score-comparison">
          <Score title="Party A" value={v.scores.partyA.overall} />
          <Score title="Party B" value={v.scores.partyB.overall} />
        </div>
      )}
      <div className="advisory">
        <AlertTriangle />
        <p>
          <strong>Advisory and non-binding.</strong> This is an AI-generated assessment, not a
          determination of objective truth or legal arbitration.
        </p>
      </div>
    </div>
  );
}
function Score({ title, value }: { title: string; value: number }) {
  return (
    <div>
      <span>{title}</span>
      <strong>{value}</strong>
      <div>
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function SettingsPanel({
  id,
  data,
  load,
}: {
  id: string;
  data: RoomData;
  load: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const create = async () => {
    setCreating(true);
    const value = await api<any>(`/conflicts/${id}/share-links`, { method: 'POST', body: '{}' });
    await copyText(value.share_link.url);
    await load();
    setCreating(false);
  };
  return (
    <div className="settings-panel">
      <div className="record-title">
        <div>
          <h2>Sharing and case settings</h2>
          <p>Observer access is always unlisted, read-only, and revocable.</p>
        </div>
      </div>
      <section>
        <div className="settings-heading">
          <div>
            <Link2 />
            <span>
              <h3>Unlisted observer links</h3>
              <p>
                {data.conflict.judge_available
                  ? 'Safe transcript and verdict only.'
                  : 'Safe transcript only.'}{' '}
                Private events are filtered from the canonical record.
              </p>
            </span>
          </div>
          <button className="button" onClick={() => void create()} disabled={creating}>
            {creating ? (
              'Creating…'
            ) : (
              <>
                <Share2 />
                Create and copy link
              </>
            )}
          </button>
        </div>
        {data.shareLinks.length ? (
          <div className="share-link-list">
            {data.shareLinks.map((link) => (
              <div key={link.id}>
                <span>
                  <Link2 />
                  <code>{link.id}</code>
                  <small>
                    {link.revoked_at
                      ? 'Revoked'
                      : link.expires_at
                        ? `Expires ${new Date(link.expires_at).toLocaleDateString()}`
                        : 'No expiration'}
                  </small>
                </span>
                {!link.revoked_at && (
                  <button
                    className="button secondary"
                    onClick={async () => {
                      await api(`/conflicts/${id}/share-links/${link.id}`, { method: 'DELETE' });
                      await load();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-row">No observer links have been created.</p>
        )}
      </section>
      <section>
        <div className="settings-heading">
          <div>
            <FileText />
            <span>
              <h3>Case integrity</h3>
              <p>
                The transcript is append-only. Resolved arguments and evidence cannot be rewritten.
              </p>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
