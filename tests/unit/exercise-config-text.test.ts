/**
 * Round 20 text-lock tests. Some exercise configs went through user-driven
 * text revisions where stale phrasing kept slipping back in. These assertions
 * lock the corrected wording so it can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { warriorTwoConfig } from '@/config/exercises/warrior-2.config';
import { mountainPoseConfig } from '@/config/exercises/mountain-pose.config';

describe('warrior-2 config text — Round 20 front-facing correction', () => {
  it('first instruction directs the user to FACE the camera (not side-on)', () => {
    const first = warriorTwoConfig.instructions[0];
    expect(first.toLowerCase()).toContain('facing the camera');
    expect(first.toLowerCase()).not.toContain('side-on');
    expect(first.toLowerCase()).not.toContain('side profile');
  });

  it('no instruction mentions side-on / side profile orientation', () => {
    const all = warriorTwoConfig.instructions.join('\n').toLowerCase();
    expect(all).not.toContain('side-on');
    expect(all).not.toContain('side profile');
  });
});

describe('mountain-pose config text — Round 20 calf-raise rollback', () => {
  // Round 19 added calf-raise (heels lifted) to Tadasana; Round 20 rolled it
  // back per user direction. Instructions must not mention heel lift / calf
  // raise / balls of feet anymore.
  it('no instruction mentions lifting heels or rising onto toes', () => {
    const all = mountainPoseConfig.instructions.join('\n').toLowerCase();
    expect(all).not.toContain('heel');
    expect(all).not.toContain('balls of');
    expect(all).not.toContain('calf raise');
    expect(all).not.toContain('onto your toes');
    expect(all).not.toContain('rise up');
  });

  it('no commonError mentions heels returning to the floor', () => {
    const errs = mountainPoseConfig.commonErrors.map((e) => `${e.error} ${e.cameraDetection}`.toLowerCase()).join('\n');
    expect(errs).not.toContain('heels returning');
    expect(errs).not.toContain('calf raise');
    expect(errs).not.toContain('losing the calf');
  });

  it('still instructs the user to reach arms overhead (kept from round 19)', () => {
    const all = mountainPoseConfig.instructions.join('\n').toLowerCase();
    expect(all).toContain('overhead');
  });
});
