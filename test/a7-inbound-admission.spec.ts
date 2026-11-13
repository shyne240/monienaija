import { UnavailableA7InboundExecutionAuthority } from '../src/policy/a7-inbound-execution-authority';
import { UnavailableA7InboundAdmissionAuthority } from '../src/policy/a7-inbound-admission-authority';
import { A7_INBOUND_ADMISSION_PROFILE } from '../src/policy/a7-inbound-admission.profile';
import { A7_PRODUCT_POLICY_PROFILES } from '../src/policy/a7-product-policy.profiles';

describe('A7 inbound admission contract', () => {
  it('fails closed until a trusted authority is provided', async () => {
    expect(await new UnavailableA7InboundAdmissionAuthority().recheck()).toEqual({
      status: 'UNAVAILABLE',
    });
  });
  it('fails closed without a governed execution authority', async () => {
    expect(await new UnavailableA7InboundExecutionAuthority().authorize()).toEqual({
      status: 'UNAVAILABLE',
    });
  });
  it('separates inbound obligations from the existing A6 outbound profiles', () => {
    expect(A7_INBOUND_ADMISSION_PROFILE.capability).toBe('product.virtual-account.inbound');
    expect(A7_INBOUND_ADMISSION_PROFILE.obligations.map((item) => item.code)).toContain(
      'VERIFY_RECEIPT_AND_LIMIT_BEFORE_CREDIT',
    );
    expect(A7_INBOUND_ADMISSION_PROFILE.obligations.map((item) => item.code)).not.toContain(
      'RECHECK_A6_PARTNER_REFERENCE',
    );
    expect(
      A7_PRODUCT_POLICY_PROFILES.some((profile) =>
        profile.obligations.some((item) => item.code === 'RECHECK_A6_PARTNER_REFERENCE'),
      ),
    ).toBe(true);
  });
});
