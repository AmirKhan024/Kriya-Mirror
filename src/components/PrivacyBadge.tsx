/**
 * Reassuring privacy line — shown on the landing page and on the setup
 * screen so users know their camera feed is never recorded or uploaded.
 *
 * `compact` variant is a single inline pill for the landing page.
 * Default variant is a richer card for the setup page (where camera is about to start).
 */
interface Props {
  variant?: 'compact' | 'full';
}

export function PrivacyBadge({ variant = 'compact' }: Props) {
  if (variant === 'compact') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-accent-teal-border bg-accent-teal-soft text-sm">
        <span aria-hidden className="text-base">🔒</span>
        <span className="text-foreground">
          Your camera stays on your device. Nothing is recorded or uploaded.
        </span>
      </div>
    );
  }

  return (
    <div className="card p-5 border-accent-teal-border bg-accent-teal-soft">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl">🔒</span>
        <div>
          <div className="text-base font-semibold text-white mb-1">
            Your privacy is protected
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            Your camera feed is processed only on this device. We never record, upload, or
            store any video or photos. Close the tab and it&apos;s gone.
          </p>
        </div>
      </div>
    </div>
  );
}
