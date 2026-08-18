/**
 * Training data consent.
 *
 * Consent is a record, not a boolean. Regulators and App Review both ask the
 * same question — what exactly did this person agree to, and when — and a bare
 * true cannot answer it. So a grant stores the moment it was given and the
 * version of the policy it was given against.
 *
 * That version is what makes a later policy change honest. If the terms of the
 * contribution change, previously granted consent no longer matches the current
 * version and must be asked for again rather than silently inherited.
 *
 * Default is off. Not "off until we ask nicely" — off, with every feature of the
 * app working identically either way, which is what makes the consent freely
 * given rather than coerced.
 */

/**
 * Bumped whenever what we collect, or what we do with it, materially changes.
 * Anything else — typos, formatting, clarifications — leaves it alone.
 */
export const CONSENT_VERSION = 1;

export const CONSENT_SUMMARY =
  'Contribute target photos to improve shot detection';

/** A fresh, ungranted record. */
export function noConsent() {
  return { granted: false, at: null, version: null };
}

export function grantConsent(now = Date.now()) {
  return { granted: true, at: now, version: CONSENT_VERSION };
}

export function revokeConsent(prev, now = Date.now()) {
  return { granted: false, at: null, version: null, revokedAt: now, ...( prev?.at ? { previouslyGrantedAt: prev.at } : {}) };
}

/**
 * Whether a stored record still authorises contribution *now*.
 *
 * A grant against an older policy version does not carry forward. Treating it
 * as current would mean using someone's images under terms they never saw.
 */
export function consentIsCurrent(record) {
  return Boolean(
    record &&
    record.granted === true &&
    record.version === CONSENT_VERSION
  );
}

/** True when consent was given but the policy has since materially changed. */
export function consentNeedsRenewal(record) {
  return Boolean(
    record &&
    record.granted === true &&
    record.version !== CONSENT_VERSION
  );
}

/**
 * Whether a specific captured target may be contributed.
 *
 * Targets record the consent state at the moment they were captured, because
 * that is when the decision applied. Switching consent on later must not
 * retroactively authorise photographs taken while it was off — the person had
 * no expectation those would be used.
 */
export function targetIsContributable(target) {
  return Boolean(
    target &&
    target.contributeConsent &&
    target.contributeConsent.version === CONSENT_VERSION
  );
}

/** Human-readable description of a stored record, for the settings screen. */
export function describeConsent(record) {
  if (consentNeedsRenewal(record)) {
    return 'What we collect has changed since you agreed. Review and confirm again to keep contributing.';
  }
  if (!consentIsCurrent(record)) {
    return 'Off. Your photos are used to measure the group and then discarded — nothing leaves this device.';
  }
  const when = record.at ? new Date(record.at).toLocaleDateString() : 'unknown date';
  return `On since ${when}. Photos captured from now on may be used to train shot detection. Nothing else from your account is included.`;
}
