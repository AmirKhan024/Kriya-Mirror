/**
 * Centralized debug logger — mirrors the pattern from
 * kriya-activities/mobility_new/spinal_wave/js/debug.js
 *
 * Three levels (quiet < info < verbose):
 *   - quiet   : only critical state transitions + rep/hold completion
 *   - info    : everything important (default). Calibration milestones, reps,
 *               rejections, posture warnings, hold ticks.
 *   - verbose : adds per-frame STATE transitions and per-tick TICK samples.
 *
 * Toggle in browser DevTools console:
 *   localStorage.KRIYA_DEBUG_LEVEL = 'verbose'   // see everything
 *   localStorage.KRIYA_DEBUG_LEVEL = 'quiet'     // see only critical events
 *   delete localStorage.KRIYA_DEBUG_LEVEL        // back to default 'info'
 *
 * Output format (one line per event, easy to grep / copy-paste to Claude):
 *   [KriyaMirror][SQUAT][REP] Rep 7 complete (depth=85°, MQS=82) | {warnings:["heel-lift"]} (t=14523ms)
 *
 * SSR-safe: no-ops on the server (typeof window === 'undefined').
 */

export type DebugLevel = 'quiet' | 'info' | 'verbose';

export type DebugCategory =
  // Shared / squat
  | 'CALIB'
  | 'STATE'
  | 'REP'
  | 'REJECT'
  | 'WARN'
  | 'SCORE'
  // Plank
  | 'HOLD'
  | 'TICK'
  | 'BROKEN'
  | 'TIMER';   // 2026-05-25 round 3: plank counter freeze/resume during sustained bad form

export type EngineTag = 'SQUAT' | 'PLANK' | 'PUSHUP' | 'LUNGE' | 'TANDEM' | 'CURL' | 'SLS' | 'CHAIR' | 'RAISE' | 'TREE' | 'WARRIOR' | 'WARRIOR1' | 'WARRIOR3' | 'MOUNTAIN' | 'CALF' | 'JACKS' | 'KNEES' | 'FRONT' | 'CIRCLES' | 'GODDESS' | 'TRIANGLE' | 'WALLSIT' | 'LEGRAISE' | 'SIDEBEND' | 'REVLUNGE' | 'LATERALLUNGE' | 'SIDEPLANK' | 'BOAT' | 'SIT2STAND' | 'FOLD' | 'DOG' | 'COBRA' | 'MARCH' | 'SFOLD' | 'STAR' | 'FIG4' | 'GATE' | 'COSSACK' | 'LEGSWING' | 'CATCOW';

const LEVEL_RANK: Record<DebugLevel, number> = { quiet: 0, info: 1, verbose: 2 };

// Categories that are noisy enough we only want them in verbose mode
const VERBOSE_ONLY = new Set<DebugCategory>(['STATE', 'TICK']);

// Categories that should still appear even in quiet mode
const QUIET_KEEPS = new Set<DebugCategory>(['REP', 'REJECT', 'BROKEN', 'SCORE']);

function currentLevel(): DebugLevel {
  if (typeof window === 'undefined') return 'info';
  const raw = window.localStorage?.getItem('KRIYA_DEBUG_LEVEL');
  if (raw === 'quiet' || raw === 'info' || raw === 'verbose') return raw;
  return 'info';
}

function shouldEmit(category: DebugCategory, level: DebugLevel): boolean {
  if (VERBOSE_ONLY.has(category)) return level === 'verbose';
  if (level === 'quiet') return QUIET_KEEPS.has(category);
  return true; // info or verbose, non-verbose-only category
}

/**
 * Log a structured event.
 *
 * @param engine    Which engine fired the event (SQUAT or PLANK)
 * @param category  Event type (CALIB, STATE, REP, REJECT, WARN, SCORE, HOLD, TICK, BROKEN)
 * @param message   Human-readable headline (no data — keep it short, scannable)
 * @param data      Optional structured payload (auto-JSON.stringified)
 */
export function debugLog(
  engine: EngineTag,
  category: DebugCategory,
  message: string,
  data?: unknown,
): void {
  if (typeof window === 'undefined') return;
  const level = currentLevel();
  if (!shouldEmit(category, level)) return;

  const tStr =
    typeof performance !== 'undefined' && performance.now
      ? performance.now().toFixed(0)
      : Date.now().toString();

  let dataStr = '';
  if (data !== undefined) {
    if (typeof data === 'object' && data !== null) {
      try {
        dataStr = ' | ' + JSON.stringify(data);
      } catch {
        dataStr = ' | [unserializable]';
      }
    } else {
      dataStr = ' | ' + String(data);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[KriyaMirror][${engine}][${category}] ${message}${dataStr} (t=${tStr}ms)`);
}

/** Convenience: returns true if verbose logging is enabled. Engines can use
 *  this to skip expensive data-prep when no one is listening. */
export function isVerbose(): boolean {
  return currentLevel() === 'verbose';
}
