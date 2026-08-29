import { Check, Copy, HardDrive, LoaderCircle, ServerOff, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';
import { copyText } from './clipboard';
import { Dialog } from './components';

export function AgentRemovalDialog({
  open,
  agent,
  onClose,
  onRemoved,
}: {
  open: boolean;
  agent: { id: string; name?: string } | null;
  onClose: () => void;
  onRemoved: () => Promise<void> | void;
}) {
  const [cleanup, setCleanup] = useState<any>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !agent) return;
    setCleanup(null);
    setAcknowledged(false);
    setCopied(false);
    setError('');
    void api<any>(`/agents/${agent.id}/local-cleanup`, { cache: 'no-store' })
      .then(setCleanup)
      .catch((value) =>
        setError(value instanceof Error ? value.message : 'Could not prepare local cleanup.'),
      );
  }, [open, agent?.id]);

  const remove = async () => {
    if (!agent) return;
    setBusy(true);
    setError('');
    try {
      await api(`/agents/${agent.id}`, { method: 'DELETE' });
      await onRemoved();
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not remove this agent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${agent?.name ?? 'this agent'} safely`}
      description="A website cannot directly stop processes or erase credentials on your computer. Complete these two explicit steps."
    >
      <div className="agent-cleanup-flow">
        <section className="cleanup-step recommended">
          <header>
            <span>1</span>
            <div>
              <strong>Clean this computer</strong>
              <small>Recommended before server removal</small>
            </div>
          </header>
          <p>
            Send the generated instruction to the Codex task on the computer that runs this agent.
            It stops the background service and removes the Runner process, private runtime, logs,
            and this site’s stored credential.
          </p>
          <button
            className="button secondary wide"
            disabled={!cleanup || busy}
            onClick={async () => {
              try {
                await copyText(cleanup.instruction);
                setCopied(true);
              } catch (value) {
                setError(
                  value instanceof Error ? value.message : 'Could not copy the instruction.',
                );
              }
            }}
          >
            {!cleanup ? <LoaderCircle className="spin" /> : copied ? <Check /> : <Copy />}
            {!cleanup
              ? 'Preparing secure cleanup…'
              : copied
                ? 'Cleanup instruction copied'
                : 'Copy local cleanup instruction'}
          </button>
          <div className="cleanup-scope">
            <HardDrive />
            <span>Local-only and idempotent. It does not expose the credential.</span>
          </div>
        </section>

        <section className="cleanup-step destructive">
          <header>
            <span>2</span>
            <div>
              <strong>Remove from ResolveRoom</strong>
              <small>Permanent server-side cleanup</small>
            </div>
          </header>
          <p>
            This revokes every API credential and pairing code, disconnects the Runner, removes the
            Agent identity, and unbinds it from unfinished setup rooms. It cannot be undone.
          </p>
          <label className="cleanup-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I ran step 1, or I no longer have access to that computer and understand local files
              may remain there.
            </span>
          </label>
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Keep agent
          </button>
          <button
            className="button danger"
            disabled={!acknowledged || busy || !cleanup}
            onClick={() => void remove()}
          >
            {busy ? <LoaderCircle className="spin" /> : <ServerOff />}
            Remove permanently
          </button>
        </div>
        <p className="cleanup-privacy">
          <ShieldCheck /> The cleanup instruction contains no long-lived credential.
        </p>
      </div>
    </Dialog>
  );
}
