/**
 * Validates training-data consent.
 *
 * Two properties carry the weight, and both are about not using an image the
 * person did not agree to give.
 *
 * Consent granted against an older policy version must not carry forward. If it
 * did, a change to what we collect would silently apply to someone who agreed to
 * something else.
 *
 * And switching consent on must not retroactively authorise photographs already
 * taken. Someone who shot ten sessions with it off had no expectation those
 * would be used, and enabling it later cannot manufacture that expectation.
 *
 * Run: node scripts/test-consent.mjs
 */
import {
  CONSENT_VERSION, noConsent, grantConsent, revokeConsent,
  consentIsCurrent, consentNeedsRenewal, targetIsContributable, describeConsent,
} from '../lib/consent.js';

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log((ok ? '✓ ' : '✗ ') + name.padEnd(56) + detail);
};

console.log('the default');
{
  const n = noConsent();
  check('  is off', n.granted === false);
  check('  and does not authorise contribution', !consentIsCurrent(n));
  check('  missing entirely is also off',
    !consentIsCurrent(null) && !consentIsCurrent(undefined) && !consentIsCurrent({}));
  check('  the copy says nothing leaves the device',
    /nothing leaves this device/i.test(describeConsent(n)));
}

console.log('\ngranting');
{
  const g = grantConsent(1_700_000_000_000);
  check('  records the moment', g.at === 1_700_000_000_000);
  check('  records the policy version', g.version === CONSENT_VERSION);
  check('  authorises contribution', consentIsCurrent(g));
  check('  and does not need renewal', !consentNeedsRenewal(g));
  check('  the copy states when and what', /On since/.test(describeConsent(g)) &&
    /Nothing else from your account/.test(describeConsent(g)));
}

console.log('\na stale policy version does not carry forward');
{
  // Someone agreed to version 1; the terms have since changed.
  const old = { granted: true, at: 1_600_000_000_000, version: CONSENT_VERSION - 1 };
  check('  no longer authorises contribution', !consentIsCurrent(old),
    'agreeing to the old terms is not agreeing to the new ones');
  check('  and is flagged for renewal', consentNeedsRenewal(old));
  check('  with copy that asks again',
    /Review and confirm again/.test(describeConsent(old)));
  check('  a current grant is not flagged', !consentNeedsRenewal(grantConsent()));
  check('  an ungranted record is not flagged either',
    !consentNeedsRenewal(noConsent()) && !consentNeedsRenewal(null));
}

console.log('\nrevoking');
{
  const g = grantConsent(1_700_000_000_000);
  const r = revokeConsent(g, 1_700_000_100_000);
  check('  stops authorising immediately', !consentIsCurrent(r));
  check('  keeps when it was revoked', r.revokedAt === 1_700_000_100_000);
  check('  and remembers it was once granted', r.previouslyGrantedAt === 1_700_000_000_000,
    'so a support request to delete past uploads can be dated');
  check('  revoking with no prior grant is safe', revokeConsent(null).granted === false);
}

console.log('\nconsent is not retroactive');
{
  // The property that matters most. Turning it on today must not authorise
  // photographs taken while it was off.
  const before = { id: 't1', shots: [] };                                  // captured with consent off
  const during = { id: 't2', shots: [], contributeConsent: grantConsent() }; // captured with it on
  check('  a target captured before consent is not contributable',
    !targetIsContributable(before));
  check('  a target captured under consent is', targetIsContributable(during));

  // And a target captured under an older policy is not swept in by a bump.
  const stale = { id: 't3', shots: [], contributeConsent: { granted: true, at: 1, version: CONSENT_VERSION - 1 } };
  check('  nor is one captured under older terms', !targetIsContributable(stale),
    'a version bump must not retroactively widen what was agreed');

  check('  junk is safe',
    !targetIsContributable(null) && !targetIsContributable({}) &&
    !targetIsContributable({ contributeConsent: true }));
}

console.log('\n' + (fails === 0 ? 'all checks passed' : `${fails} check(s) failed`));
process.exit(fails === 0 ? 0 : 1);
