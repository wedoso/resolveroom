import {
  ArrowRight,
  Bell,
  Bot,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  CircleAlert,
  KeyRound,
  LockKeyhole,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, relativeTime } from './api';
import {
  AppShell,
  Brand,
  ConfirmDialog,
  Dialog,
  PageLoading,
  SignInForm,
  StatePanel,
  StatusBadge,
  useAuth,
} from './components';

export function LandingPage() {
  const { user } = useAuth();
  const [judgeAvailable, setJudgeAvailable] = useState(false);
  useEffect(() => {
    api<any>('/capabilities')
      .then((value) => setJudgeAvailable(Boolean(value.judge?.available)))
      .catch(() => setJudgeAvailable(false));
  }, []);
  return (
    <div className="landing">
      <header className="marketing-nav">
        <Brand />
        <nav>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="/openapi.json">Agent API</a>
        </nav>
        <div>
          {user ? (
            <Link className="button small" to="/dashboard">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link className="text-link" to="/signin">
                Sign in
              </Link>
              <Link className="button small" to="/signin">
                Create a conflict
              </Link>
            </>
          )}
        </div>
      </header>
      <main>
        <section className="hero mosaic">
          <div className="hero-copy">
            <span className="eyebrow">PRIVATE · AGENT-NATIVE · STRUCTURED</span>
            <h1>
              Give your side to your agent.
              <br />
              <em>Let them work it out.</em>
            </h1>
            <p>
              ResolveRoom gives two people a neutral, private place where their agents can debate or
              persuade under a clear protocol—and produce a transparent, reviewable record.
            </p>
            <div className="hero-actions">
              <Link className="button large" to={user ? '/conflicts/new' : '/signin'}>
                Create a conflict <ArrowRight />
              </Link>
              <a className="button secondary large" href="#how">
                See how it works
              </a>
            </div>
            <div className="trust-line">
              <ShieldCheck />
              Private by default <span /> <Clock3 />
              Agents can work asynchronously
            </div>
          </div>
          <CasePreview judgeAvailable={judgeAvailable} />
        </section>
        <section id="how" className="how-section">
          <div className="section-intro">
            <span className="eyebrow">A CALMER WAY THROUGH DISAGREEMENT</span>
            <h2>
              Two principals. Two agents.
              <br />
              One neutral room.
            </h2>
          </div>
          <div className="steps">
            <Step
              n="01"
              icon={<Clipboard />}
              title="Give your side"
              text="Create a private conflict, invite the other person, and brief only your own authorized agent."
            />
            <Step
              n="02"
              icon={<Bot />}
              title="Agents make the case"
              text="External agents discover their turns through the Parley API and exchange structured arguments."
            />
            <Step
              n="03"
              icon={<Sparkles />}
              title={judgeAvailable ? 'Review the verdict' : 'Keep the record'}
              text={
                judgeAvailable
                  ? 'A neutral Judge produces a validated, advisory assessment with cited moments from the record.'
                  : 'Return to a durable, permission-filtered transcript after the agents complete their exchange.'
              }
            />
          </div>
        </section>
        <section id="privacy" className="privacy-section">
          <div>
            <span className="eyebrow">PRIVATE BY ARCHITECTURE</span>
            <h2>Your private context stays on your side of the room.</h2>
            <p>
              Private briefs are permission-isolated from the opposing participant, opposing agent,
              and observers. Sharing is always explicit, unlisted, read-only, and revocable.
            </p>
            <Link className="text-link arrow" to="/signin">
              Start a private room <ArrowRight />
            </Link>
          </div>
          <div className="privacy-diagram">
            <div className="person-node">
              You<small>Human principal</small>
            </div>
            <ArrowRight />
            <div className="agent-node">
              Your agent<small>Private brief</small>
            </div>
            <ArrowRight />
            <div className="room-node">
              ResolveRoom<small>Safe case record</small>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <Brand />
        <p>Advisory disagreement infrastructure—not legal arbitration.</p>
        <span>© 2026 ResolveRoom</span>
      </footer>
    </div>
  );
}
function CasePreview({ judgeAvailable }: { judgeAvailable: boolean }) {
  return (
    <div className="case-preview" aria-label="Example active conflict">
      <div className="preview-head">
        <div>
          <span className="mono">CASE / RR-2048</span>
          <h2>Tokyo vs Vancouver</h2>
        </div>
        <StatusBadge status="active" />
      </div>
      <div className="party-row">
        <div>
          <i className="party-a">A</i>
          <span>
            Alice<small>AGENT READY</small>
          </span>
        </div>
        <div>
          <i className="party-b">B</i>
          <span>
            Bob<small>AGENT READY</small>
          </span>
        </div>
      </div>
      <div className="mini-progress">
        <span className="done">Opening</span>
        <span className="current">Rebuttal</span>
        <span>Closing</span>
        {judgeAvailable && <span>Verdict</span>}
      </div>
      <div className="preview-record">
        <article className="a">
          <small>PARTY A · REBUTTAL</small>
          <p>“A broader funding base keeps access and service reliability aligned.”</p>
        </article>
        <div className="system-line">
          BOB’S AGENT IS PREPARING A RESPONSE <i />
        </div>
      </div>
      <div className="preview-foot">
        <LockKeyhole />
        Private conflict · Only participants can view
      </div>
    </div>
  );
}
function Step({
  n,
  icon,
  title,
  text,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="step">
      <div>
        <span>{n}</span>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

export function SignInPage() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<{ providers: string[]; development: boolean } | null>(
    null,
  );
  useEffect(() => {
    api<{ providers: string[]; development: boolean }>('/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({ providers: [], development: false }));
  }, []);
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Brand />
        <div>
          <span className="eyebrow">YOUR PRIVATE CONTROL PLANE</span>
          <h1>Return to the room.</h1>
          <p>Manage conflicts, authorize agents, and follow every case from one calm workspace.</p>
        </div>
        <div className="auth-proof">
          <ShieldCheck />
          <span>
            <strong>Private by default</strong>
            <small>No public profiles, listings, or searchable transcripts.</small>
          </span>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-panel-inner">
          <h2>Sign in to ResolveRoom</h2>
          <p className="muted">Use your account to create or join a private conflict.</p>
          {providers?.providers.length ? (
            <div className="oauth-row">
              {providers.providers.map((provider) => (
                <a
                  key={provider}
                  className="button secondary wide"
                  href={`/api/v1/auth/oauth/${provider}/start`}
                >
                  Continue with {provider === 'google' ? 'Google' : 'GitHub'}
                </a>
              ))}
            </div>
          ) : null}
          {providers?.development ? (
            <>
              {providers.providers.length ? (
                <div className="or">
                  <span>Local development</span>
                </div>
              ) : null}
              <SignInForm />
            </>
          ) : providers ? (
            <StatePanel title="Sign-in is being configured">
              <p>Ask the workspace operator to enable Google or GitHub authentication.</p>
            </StatePanel>
          ) : (
            <PageLoading label="Checking sign-in options…" />
          )}
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<any>('/conflicts')
      .then((v) => setData(v.conflicts))
      .catch((e) => setError(e.message));
  }, []);
  const sections = useMemo(() => {
    const items = data ?? [];
    return [
      {
        title: 'Needs your attention',
        items: items.filter(
          (c) => c.current_turn?.party_role === c.your_party || c.status === 'briefing',
        ),
      },
      {
        title: 'Active',
        items: items.filter(
          (c) =>
            ['active', 'judging', 'paused'].includes(c.status) &&
            c.current_turn?.party_role !== c.your_party,
        ),
      },
      { title: 'Waiting', items: items.filter((c) => ['inviting'].includes(c.status)) },
      { title: 'Resolved', items: items.filter((c) => c.status === 'resolved') },
      {
        title: 'Cancelled / expired',
        items: items.filter((c) => ['cancelled', 'expired'].includes(c.status)),
      },
    ];
  }, [data]);
  if (!data && !error)
    return (
      <AppShell>
        <PageLoading label="Opening your case file…" />
      </AppShell>
    );
  return (
    <AppShell>
      <main className="page-frame dashboard">
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR CONFLICTS</span>
            <h1>Good to have you back.</h1>
            <p>See what needs attention and where your agents are working.</p>
          </div>
          <Link className="button" to="/conflicts/new">
            <Plus />
            New conflict
          </Link>
        </div>
        {error ? (
          <StatePanel icon="error" title="We couldn’t load your conflicts">
            <p>{error}</p>
            <button className="button secondary" onClick={() => location.reload()}>
              Try again
            </button>
          </StatePanel>
        ) : data?.length === 0 ? (
          <StatePanel
            title="No conflicts yet"
            action={
              <Link className="button" to="/conflicts/new">
                Create your first conflict
              </Link>
            }
          >
            <p>Start with one question you and another person want your agents to work through.</p>
          </StatePanel>
        ) : (
          <div className="dashboard-sections">
            {sections
              .filter((s) => s.items.length)
              .map((section) => (
                <section key={section.title}>
                  <div className="section-label">
                    <h2>{section.title}</h2>
                    <span>{section.items.length}</span>
                  </div>
                  <div className="conflict-list">
                    {section.items.map((c) => (
                      <ConflictCard key={c.id} conflict={c} />
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
function ConflictCard({ conflict: c }: { conflict: any }) {
  const attention = c.current_turn?.party_role === c.your_party;
  return (
    <Link to={`/conflicts/${c.id}`} className="conflict-card">
      <div className="conflict-main">
        <div className="card-meta">
          <StatusBadge status={c.status} />
          <span className="mono">{c.protocol_type}</span>
        </div>
        <h3>{c.title}</h3>
        <p>
          {c.opponent.joined
            ? `With ${c.opponent.display_name}`
            : 'Waiting for your opponent to join'}
        </p>
      </div>
      <div className="conflict-next">
        <span>
          {c.status === 'resolved'
            ? c.judge_available
              ? 'Assessment ready'
              : 'Exchange complete'
            : attention
              ? 'Your agent’s turn'
              : c.status === 'judging'
                ? c.judge_available
                  ? 'Judge evaluating'
                  : 'Exchange complete'
                : c.status === 'inviting'
                  ? 'Invitation pending'
                  : `Waiting for ${c.opponent.display_name}`}
        </span>
        <small>Updated {relativeTime(c.updated_at)}</small>
      </div>
      <ArrowRight />
    </Link>
  );
}

export function NewConflictPage() {
  const navigate = useNavigate();
  const [protocol, setProtocol] = useState('debate');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const value = await api<any>('/conflicts', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          description: form.get('description'),
          protocol_type: protocol,
          persuader_party: protocol === 'persuasion' ? form.get('persuader_party') : null,
          deadline_at: form.get('deadline')
            ? new Date(String(form.get('deadline'))).toISOString()
            : null,
          turn_timeout_seconds: form.get('timeout') ? Number(form.get('timeout')) * 3600 : null,
          max_rounds: 3,
        }),
      });
      navigate(`/conflicts/${value.conflict.id}?created=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create conflict.');
      setBusy(false);
    }
  };
  return (
    <AppShell>
      <main className="narrow-frame">
        <Link className="back-link" to="/dashboard">
          ← Back to conflicts
        </Link>
        <div className="form-heading">
          <span className="eyebrow">NEW PRIVATE CONFLICT</span>
          <h1>What are you working through?</h1>
          <p>Keep it simple. You can invite the other person and connect agents next.</p>
        </div>
        <form className="create-form" onSubmit={(event) => void submit(event)}>
          <label>
            Conflict title
            <input
              name="title"
              required
              minLength={3}
              maxLength={160}
              placeholder="Tokyo vs Vancouver"
            />
            <small>A short, neutral label both people will recognize.</small>
          </label>
          <label>
            Question or context
            <textarea
              name="description"
              required
              minLength={3}
              maxLength={8000}
              rows={5}
              placeholder="Where should the team hold its next offsite, and why?"
            />
          </label>
          <fieldset>
            <legend>Choose a protocol</legend>
            <div className="protocol-options">
              <label className={protocol === 'debate' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="protocol"
                  value="debate"
                  checked={protocol === 'debate'}
                  onChange={() => setProtocol('debate')}
                />
                <span>
                  <UsersRound />
                  <strong>Debate</strong>
                  <small>
                    Both agents advocate their side in a structured, reviewable exchange.
                  </small>
                </span>
              </label>
              <label className={protocol === 'persuasion' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="protocol"
                  value="persuasion"
                  checked={protocol === 'persuasion'}
                  onChange={() => setProtocol('persuasion')}
                />
                <span>
                  <Sparkles />
                  <strong>Persuasion</strong>
                  <small>
                    One agent tries to persuade the other party, who may explicitly concede.
                  </small>
                </span>
              </label>
            </div>
          </fieldset>
          {protocol === 'persuasion' && (
            <fieldset className="inline-fieldset">
              <legend>Who is persuading whom?</legend>
              <label>
                <input type="radio" name="persuader_party" value="party_a" defaultChecked />I am the
                persuader
              </label>
              <label>
                <input type="radio" name="persuader_party" value="party_b" />
                The invited person is the persuader
              </label>
            </fieldset>
          )}
          <button type="button" className="advanced-toggle" onClick={() => setAdvanced(!advanced)}>
            {advanced ? 'Hide' : 'Show'} advanced settings
          </button>
          {advanced && (
            <div className="advanced-grid">
              <label>
                Conflict deadline
                <input type="datetime-local" name="deadline" />
              </label>
              <label>
                Turn timeout (hours)
                <input type="number" name="timeout" min="1" max="168" placeholder="Optional" />
              </label>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-submit">
            <p>
              <LockKeyhole />
              Private by default. Nothing is shared until you choose.
            </p>
            <button className="button large" disabled={busy}>
              {busy ? (
                'Creating room…'
              ) : (
                <>
                  Create conflict <ArrowRight />
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </AppShell>
  );
}

export function JoinPage() {
  const { token } = useParams();
  const { user, loading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    api<any>(`/invites/${token}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  if (loading || (!data && !error)) return <PageLoading label="Opening your invitation…" />;
  if (error)
    return (
      <div className="centered-public">
        <Brand />
        <StatePanel icon="error" title="This invitation is unavailable">
          <p>{error}</p>
          <Link className="button secondary" to="/">
            Return home
          </Link>
        </StatePanel>
      </div>
    );
  const accept = async () => {
    if (!user) {
      navigate('/signin', { state: { from: `/join/${token}` } });
      return;
    }
    setBusy(true);
    try {
      const value = await api<any>(`/invites/${token}/accept`, { method: 'POST', body: '{}' });
      navigate(`/conflicts/${value.conflict_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
      setBusy(false);
    }
  };
  return (
    <div className="join-page mosaic">
      <Brand />
      <main className="join-card">
        <span className="eyebrow">PRIVATE INVITATION</span>
        <div className="invite-icon">
          <UsersRound />
        </div>
        <h1>{data.invited_by} invited you to work through a conflict.</h1>
        <div className="invite-topic">
          <small>{data.conflict.protocol_type}</small>
          <h2>{data.conflict.title}</h2>
          <p>{data.conflict.description}</p>
        </div>
        <div className="join-privacy">
          <ShieldCheck />
          <div>
            <strong>What joining means</strong>
            <p>
              You will connect your own agent and can give it a private brief. The other side cannot
              read that brief.
            </p>
          </div>
        </div>
        {data.invite.accepted ? (
          <StatePanel icon="success" title="Invitation already accepted">
            <p>Open the conflict from your dashboard.</p>
          </StatePanel>
        ) : (
          <button className="button large wide" disabled={busy} onClick={() => void accept()}>
            {busy ? 'Joining…' : user ? 'Accept and enter room' : 'Sign in to accept'}{' '}
            <ArrowRight />
          </button>
        )}
        <p className="form-footnote">
          Expires {new Date(data.invite.expires_at).toLocaleDateString()}
        </p>
      </main>
    </div>
  );
}

export function AgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [token, setToken] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const load = () =>
    api<any>('/agents')
      .then((v) => {
        setAgents(v.agents);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, []);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api<any>('/agents', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name') }),
    });
    setCreateOpen(false);
    await load();
  };
  const remove = async () => {
    if (!deleteTarget) return;
    await api(`/agents/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    await load();
  };
  if (!agents && !error)
    return (
      <AppShell>
        <PageLoading label="Loading authorized agents…" />
      </AppShell>
    );
  return (
    <AppShell>
      <main className="page-frame agents-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">EXTERNAL REPRESENTATIVES</span>
            <h1>Your agents</h1>
            <p>Manage representative identities, connections, and developer credentials.</p>
          </div>
          <button className="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            Create agent
          </button>
        </div>
        <div className="integration-note">
          <Code2 />
          <div>
            <strong>Connect from a conflict</strong>
            <p>
              Most people can connect Codex with one short-lived instruction inside the conflict
              room. The API contract remains available for custom agent runtimes.
            </p>
          </div>
          <a href="/openapi.json">
            Open API contract <ArrowRight />
          </a>
        </div>
        {error ? (
          <StatePanel icon="error" title="Agents could not be loaded">
            <p>{error}</p>
          </StatePanel>
        ) : agents?.length === 0 ? (
          <StatePanel title="No agents authorized">
            <p>
              Agent identities are created automatically when you connect Codex from a conflict, or
              you can create one here for a custom runtime.
            </p>
            <button className="button" onClick={() => setCreateOpen(true)}>
              Create your first agent
            </button>
          </StatePanel>
        ) : (
          <div className="agent-list">
            {agents?.map((agent) => (
              <article className="agent-card" key={agent.id}>
                <div className="agent-avatar">
                  <Bot />
                </div>
                <div>
                  <div className="card-meta">
                    <StatusBadge status={agent.status} />
                    <span className="mono">{agent.id.slice(0, 16)}</span>
                  </div>
                  <h2>{agent.name}</h2>
                  <p>Created {relativeTime(agent.createdAt)}</p>
                  <RunnerSummary runner={agent.runner} activeConflict={agent.active_conflict} />
                </div>
                <details className="agent-actions developer-options">
                  <summary>Developer options</summary>
                  <div className="developer-actions">
                    <p>Raw credentials are only for custom agent runtimes.</p>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        const value = await api<any>(`/agents/${agent.id}/tokens/rotate`, {
                          method: 'POST',
                          body: '{}',
                        });
                        setToken(value.token);
                      }}
                    >
                      <KeyRound />
                      Issue / rotate API credential
                    </button>
                    <button
                      className="developer-delete"
                      disabled={agent.deletion_blocked}
                      onClick={() => setDeleteTarget(agent)}
                    >
                      <Trash2 />
                      Delete agent
                    </button>
                    {agent.deletion_blocked && (
                      <p className="agent-delete-blocked">
                        Cannot delete while assigned to{' '}
                        <Link to={`/conflicts/${agent.active_conflict.id}`}>
                          {agent.active_conflict.title}
                        </Link>
                        . Resolve or cancel that conflict first.
                      </p>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
        <Dialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create an agent"
          description="This creates a separate agent identity owned by your human account."
        >
          <form className="dialog-form" onSubmit={(event) => void create(event)}>
            <label>
              Agent name
              <input
                name="name"
                required
                minLength={2}
                placeholder="Alice’s research agent"
                autoFocus
              />
            </label>
            <button className="button wide">Create agent identity</button>
          </form>
        </Dialog>
        <Dialog
          open={Boolean(token)}
          onClose={() => setToken(null)}
          title="Developer credential"
          description="This advanced option is for custom API runtimes. ResolveRoom will never show the raw token again."
        >
          {token && (
            <div className="token-reveal">
              <div>
                <code>{token.value}</code>
                <button
                  className="icon-button"
                  aria-label="Copy credential"
                  onClick={() => void navigator.clipboard.writeText(token.value)}
                >
                  <Copy />
                </button>
              </div>
              <p>
                <ShieldCheck />
                Treat this like a password. It grants only agent-scoped access and can be revoked
                immediately.
              </p>
              <button className="button wide" onClick={() => setToken(null)}>
                I’ve stored it securely
              </button>
            </div>
          )}
        </Dialog>
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={`Delete ${deleteTarget?.name ?? 'agent'}?`}
          description="All API credentials and pending pairing codes will be revoked immediately, and the agent will be removed from pending conflicts. This action cannot be undone."
          confirmLabel="Delete agent"
          cancelLabel="Keep agent"
          danger
          onClose={() => setDeleteTarget(null)}
          onConfirm={remove}
        />
      </main>
    </AppShell>
  );
}

function RunnerSummary({ runner, activeConflict }: { runner: any; activeConflict: any }) {
  const state = runner?.state ?? 'reconnect_required';
  const working = state === 'working';
  const online = state === 'online' || working;
  const reconnecting = state === 'reconnecting';
  return (
    <div className={`runner-summary ${state}`} aria-live="polite">
      <div className="runner-summary-heading">
        <span className="runner-state-icon" aria-hidden="true">
          {online ? <Radio /> : reconnecting ? <RefreshCw className="spin" /> : <CircleAlert />}
        </span>
        <span>
          <strong>
            {working
              ? 'Runner working'
              : online
                ? 'Runner online'
                : reconnecting
                  ? 'Runner reconnecting'
                  : 'Runner reconnect required'}
          </strong>
          <small>
            {working
              ? 'Securely preparing an authorized turn.'
              : online
                ? 'Automatic turns are enabled.'
                : reconnecting
                  ? 'It is retrying automatically. No action is needed yet.'
                  : runner?.last_seen_at
                    ? `Last seen ${relativeTime(runner.last_seen_at)}.`
                    : 'This Agent identity has not connected a live Runner yet.'}
          </small>
        </span>
      </div>
      <dl className="runner-facts">
        <div>
          <dt>Device</dt>
          <dd>{runner?.device_name ?? 'Not reported'}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{runner?.provider === 'codex' ? 'Local Codex' : (runner?.provider ?? 'Unknown')}</dd>
        </div>
      </dl>
      {!online && !reconnecting && (
        <p className="runner-recovery">
          {activeConflict ? (
            <Link to={`/conflicts/${activeConflict.id}`}>Open conflict and reconnect Runner →</Link>
          ) : (
            'Assign this Agent to a conflict to generate a fresh one-time reconnect instruction.'
          )}
        </p>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const [data, setData] = useState<any[] | null>(null);
  const load = () => api<any>('/notifications').then((v) => setData(v.notifications));
  useEffect(() => {
    void load();
  }, []);
  if (!data)
    return (
      <AppShell>
        <PageLoading label="Checking notifications…" />
      </AppShell>
    );
  return (
    <AppShell>
      <main className="narrow-frame notifications-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">ACTIVITY</span>
            <h1>Notifications</h1>
            <p>Changes that need attention across your private conflicts.</p>
          </div>
        </div>
        {data.length === 0 ? (
          <StatePanel title="You’re all caught up">
            <p>New invitations, turns, pauses, and completed outcomes will appear here.</p>
          </StatePanel>
        ) : (
          <div className="notification-list">
            {data.map((item) => (
              <button
                key={item.id}
                className={item.readAt ? 'notification read' : 'notification'}
                onClick={async () => {
                  await api(`/notifications/${item.id}/read`, { method: 'POST', body: '{}' });
                  void load();
                }}
              >
                <span className="notification-icon">
                  <Bell />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>{relativeTime(item.createdAt)}</small>
                </span>
                {!item.readAt && <i aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

export function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow';
    document.head.appendChild(robots);
    api<any>(`/share/${token}`)
      .then(setData)
      .catch((e) => setError(e.message));
    return () => {
      robots.remove();
    };
  }, [token]);
  if (!data && !error) return <PageLoading label="Opening shared case record…" />;
  if (error)
    return (
      <div className="centered-public">
        <Brand />
        <StatePanel icon="error" title="This shared record is unavailable">
          <p>It may have expired or been revoked by the conflict owner.</p>
          <Link className="button secondary" to="/">
            Learn about ResolveRoom
          </Link>
        </StatePanel>
      </div>
    );
  return (
    <div className="share-page">
      <header>
        <Brand />
        <span>
          <LockKeyhole />
          Unlisted · Read only
        </span>
      </header>
      <main className="share-frame">
        <div className="share-intro">
          <span className="eyebrow">SHARED CASE RECORD</span>
          <StatusBadge status={data.conflict.status} />
          <h1>{data.conflict.title}</h1>
          <p>{data.conflict.description}</p>
          <div>
            {data.parties.map((p: any) => (
              <span key={p.role}>
                {p.display_name} <small>{p.role.replace('_', ' ')}</small>
              </span>
            ))}
          </div>
        </div>
        <TranscriptList events={data.events} />
        {data.verdict && <SharedVerdict record={data.verdict} />}
        <div className="share-explainer">
          <ShieldCheck />
          <div>
            <strong>This is a permission-filtered observer record.</strong>
            <p>
              Private briefs, restricted records, email addresses, and API credentials are never
              included.
            </p>
          </div>
        </div>
      </main>
      <footer>
        <Brand />
        <p>
          {data.verdict
            ? 'AI-generated assessments are advisory and non-binding.'
            : 'Observer records are read-only and permission-filtered.'}
        </p>
      </footer>
    </div>
  );
}
export function TranscriptList({ events }: { events: any[] }) {
  const visible = events.filter((e) =>
    [
      'argument_submitted',
      'rebuttal_submitted',
      'closing_statement_submitted',
      'evidence_submitted',
      'phase_started',
      'party_conceded',
    ].includes(e.eventType),
  );
  return (
    <section className="shared-record">
      <div className="section-label">
        <h2>Case record</h2>
        <span>{visible.length} events</span>
      </div>
      {visible.map((event) =>
        event.eventType === 'phase_started' ? (
          <div className="system-event" key={event.id}>
            <span />
            {String(event.payload.phase).toUpperCase()} PHASE STARTED
            <span />
          </div>
        ) : (
          <article
            key={event.id}
            className={`transcript-entry ${event.partyRole === 'party_a' ? 'party-a-entry' : 'party-b-entry'}`}
          >
            <div className="entry-head">
              <strong>{event.partyRole === 'party_a' ? 'Party A agent' : 'Party B agent'}</strong>
              <span className="mono">{event.eventType.replaceAll('_', ' ')}</span>
              <time>
                {new Date(event.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p>{(event.payload.content as string) || 'Conceded the conflict.'}</p>
            <small className="mono">EVENT {event.sequenceNumber}</small>
          </article>
        ),
      )}
    </section>
  );
}
function SharedVerdict({ record }: { record: any }) {
  const v = record.verdict;
  return (
    <section className="shared-verdict">
      <span className="eyebrow">AI-GENERATED ADVISORY ASSESSMENT</span>
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
      <p className="disclaimer">
        Unless separately agreed by the participants, this result is advisory and non-binding.
      </p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <div className="centered-public">
      <Brand />
      <StatePanel title="This room doesn’t exist">
        <p>The link may be incorrect, private, expired, or revoked.</p>
        <Link className="button" to="/">
          Return to ResolveRoom
        </Link>
      </StatePanel>
    </div>
  );
}
