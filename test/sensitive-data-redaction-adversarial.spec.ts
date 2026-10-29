import { REDACTED_VALUE, redactSensitiveText } from '../src/common/sensitive-data-redaction';

/**
 * R-03 + R-04 adversarial matrix (Arena 4 report 14, retest of aef51dd):
 *
 * R-03: the previous provider-reference exemption terminated the value at whitespace, so a
 *   whitespace/newline-separated sensitive suffix INSIDE a quoted `providerRef` value (and the
 *   ambiguous unquoted `token SENTINEL` shape) survived redaction. Acceptance: capture the
 *   COMPLETE quoted value through its matching quote and exempt only when that whole value is a
 *   canonical token; for unquoted prose define unambiguous boundaries and never preserve an
 *   incomplete/ambiguous token prefix merely because a space or newline follows.
 *
 * R-04: the generic sensitive-key text redactor did not consume the quote between a JSON
 *   property name and its colon, so `{"apiKey":"SECRET"}` crossed 4xx bodies and 5xx logs
 *   untouched. Acceptance: quote-aware capture of the complete quoted value for (at least)
 *   apiKey, authorization, secret and token, preserving the intended coverage of the existing
 *   sensitive-key list and JSON parseability.
 *
 * Design under test: a value-aware scanner (no lookahead exemptions): word-boundary key match
 * (normalized like the object-level redactor), quote/separator-aware scan, quoted values read
 * through the matching quote with backslash-escape pairs, unquoted values read to a hard
 * boundary, canonical-provider-token exemption only for COMPLETE values, fail-safe ambiguity
 * handling (a canonical token followed by whitespace in unquoted text is redacted through the
 * next hard delimiter because a malformed whitespace-suffixed reference cannot be ruled out).
 */
describe('redactSensitiveText — R-03/R-04 adversarial matrix', () => {
  const ROBASE = 'pvr1:robase:0123456789abcdef0123456789abcdef';
  const BREVO = 'pvr1:brevo:fedcba9876543210fedcba9876543210';
  const RESEND = 'pvr1:resend:abcdef0123456789abcdef0123456789';
  const EXTERNAL = 'pvr1:external:11223344556677889900aabbccddeeff';

  describe('1. exact valid canonical tokens are preserved (complete value only)', () => {
    it('preserves all four scopes in unquoted end/comma/colon-separator forms', () => {
      for (const token of [ROBASE, BREVO, RESEND, EXTERNAL]) {
        expect(redactSensitiveText(`providerRef=${token}`)).toBe(`providerRef=${token}`);
        expect(redactSensitiveText(`provider_ref: ${token}`)).toBe(`provider_ref: ${token}`);
        expect(redactSensitiveText(`delivered providerRef=${token}, attempts=1`)).toBe(
          `delivered providerRef=${token}, attempts=1`,
        );
        expect(redactSensitiveText(`[${token}]`)).toBe(`[${token}]`);
      }
    });

    it('preserves exact tokens in JSON-quoted key form and nested structures', () => {
      const single = `{"status":"SENT","providerRef":"${BREVO}"}`;
      expect(redactSensitiveText(single)).toBe(single);
      const nested = `{"audit":{"delivery":{"provider_ref":"${ROBASE}"}},"list":[{"providerRef":"${RESEND}"}]}`;
      expect(redactSensitiveText(nested)).toBe(nested);
      expect(JSON.parse(redactSensitiveText(nested))).toEqual(JSON.parse(nested));
    });

    it('preserves every provider-ref key spelling (camel and snake)', () => {
      for (const key of ['providerRef', 'provider_ref', 'lastTestProviderRef', 'last_tested_provider_ref', 'last_test_provider_ref']) {
        expect(redactSensitiveText(`${key}=${EXTERNAL}`)).toBe(`${key}=${EXTERNAL}`);
        expect(redactSensitiveText(`{"${key}":"${EXTERNAL}"}`)).toBe(`{"${key}":"${EXTERNAL}"}`);
      }
    });
  });

  describe('2. R-03 whitespace/newline suffixes — quoted values are read through the closing quote', () => {
    it('redacts the complete quoted value when a whitespace suffix follows a canonical token', () => {
      const input = `{"providerRef":"${BREVO} SENTINEL_JSON_SPACE_TX_NGN_999000"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('SENTINEL_JSON_SPACE_TX_NGN_999000');
      expect(out).not.toContain('TX_NGN_999000');
      expect(out).toBe(`{"providerRef":"${REDACTED_VALUE}"}`);
      // Requirement: JSON parseability preserved for valid JSON input.
      expect(JSON.parse(out)).toEqual({ providerRef: REDACTED_VALUE });
    });

    it('redacts quoted values with embedded newline and escaped-newline suffixes', () => {
      const literalNewline = `{"providerRef":"${BREVO}\nSENTINEL_NL_TX_NGN_888000"}`;
      const outNl = redactSensitiveText(literalNewline);
      expect(outNl).not.toContain('SENTINEL_NL_TX_NGN_888000');
      expect(outNl).toContain(`"${REDACTED_VALUE}"`);

      const escapedNewline = `{"providerRef":"${BREVO}\\nSENTINEL_ESC_NL_TX_NGN_777000"}`;
      const outEsc = redactSensitiveText(escapedNewline);
      expect(outEsc).not.toContain('SENTINEL_ESC_NL_TX_NGN_777000');
      expect(JSON.parse(outEsc)).toEqual({ providerRef: REDACTED_VALUE });
    });

    it('fails safe on ambiguous unquoted token + whitespace/newline suffix regions', () => {
      // Unquoted prose: a canonical token followed by whitespace cannot be distinguished from a
      // malformed reference with a whitespace suffix — the whole region up to the next hard
      // delimiter is redacted (report 14 FAIL rows; do not preserve the prefix).
      const spaced = `providerRef=${BREVO} SENTINEL_SPACE_TX_NGN_998000`;
      const outSpaced = redactSensitiveText(spaced);
      expect(outSpaced).not.toContain('SENTINEL_SPACE_TX_NGN_998000');
      expect(outSpaced).toBe(`providerRef=${REDACTED_VALUE}`);

      const newlined = `providerRef=${BREVO}\nSENTINEL_NEWLINE_TX_NGN_997000`;
      const outNl = redactSensitiveText(newlined);
      expect(outNl).not.toContain('SENTINEL_NEWLINE_TX_NGN_997000');

      const reportProbe = `providerRef=${BREVO} SPACE_SUFFIX_SENTINEL_TX_NGN_998000; {"apiKey":"JSON_KEY_SENTINEL_123"}`;
      const outProbe = redactSensitiveText(reportProbe);
      expect(outProbe).not.toContain('SPACE_SUFFIX_SENTINEL_TX_NGN_998000');
      expect(outProbe).not.toContain('JSON_KEY_SENTINEL_123');
    });
  });

  describe('3. colon/hyphen/semicolon suffixes stay redacted (report 13 regression retained)', () => {
    it('redacts every non-whitespace suffix shape, quoted and unquoted', () => {
      const shapes = [
        `providerRef=${BREVO}:SUFFIX_COLON_TX_NGN_996000`,
        `providerRef=${BREVO}-SUFFIX-HYPHEN_TX_NGN_995000`,
        `providerRef=${BREVO};SUFFIX_SEMI_TX_NGN_994000`,
        `providerRef=${BREVO}xkeysib-APPENDED993000CRED`,
        `{"providerRef":"${BREVO}:SUFFIX_JSON_COLON_TX_NGN_992000"}`,
        `last_test_provider_ref=${RESEND}:SUFFIX_KEY_TX_NGN_991000`,
      ];
      for (const input of shapes) {
        const out = redactSensitiveText(input);
        expect(out).not.toMatch(/SUFFIX|APPENDED/);
        expect(out).not.toContain('TX_NGN_99');
        expect(out).toContain(REDACTED_VALUE);
      }
    });
  });

  describe('4. R-04 JSON-quoted generic sensitive keys', () => {
    it('redacts the exact report-14 reproduction (apiKey + authorization quoted)', () => {
      const input = `{"apiKey":"SECRET_JSON_KEY_SENTINEL_123","authorization":"SECRET_AUTH_SENTINEL_456"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('SECRET_JSON_KEY_SENTINEL_123');
      expect(out).not.toContain('SECRET_AUTH_SENTINEL_456');
      expect(JSON.parse(out)).toEqual({ apiKey: REDACTED_VALUE, authorization: REDACTED_VALUE });
    });

    it('redacts secret and token keys, quoted and unquoted, single and double quotes', () => {
      expect(redactSensitiveText(`{"secret":"SEC_SENTINEL_1","token":"TOK_SENTINEL_2"}`)).toBe(
        `{"secret":"${REDACTED_VALUE}","token":"${REDACTED_VALUE}"}`,
      );
      expect(redactSensitiveText(`secret=SEC_SENTINEL_3 token=TOK_SENTINEL_4`)).toBe(
        `secret=${REDACTED_VALUE} token=${REDACTED_VALUE}`,
      );
      expect(redactSensitiveText(`{'apiKey':'SEC_SENTINEL_5'}`)).toBe(`{'apiKey':'${REDACTED_VALUE}'}`);
      expect(redactSensitiveText(`token: "TOK_SENTINEL_6"`)).toBe(`token: "${REDACTED_VALUE}"`);
    });

    it('redacts nested JSON objects and arrays with multiple sensitive values', () => {
      const input = `{"outer":{"inner":[{"apiKey":"NESTED_SENTINEL_A","safe":"visible"},{"authorization":"Bearer NESTED_SENTINEL_B"}]},"token":"NESTED_SENTINEL_C"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('NESTED_SENTINEL_A');
      expect(out).not.toContain('NESTED_SENTINEL_B');
      expect(out).not.toContain('NESTED_SENTINEL_C');
      const parsed = JSON.parse(out) as {
        outer: { inner: Array<Record<string, unknown>> };
        token: unknown;
      };
      expect(parsed.outer.inner[0]).toEqual({ apiKey: REDACTED_VALUE, safe: 'visible' });
      expect(parsed.outer.inner[1]).toEqual({ authorization: REDACTED_VALUE });
      expect(parsed.token).toBe(REDACTED_VALUE);
    });

    it('preserves the intended coverage of the pre-existing sensitive-key list (bare-text forms)', () => {
      const out = redactSensitiveText(
        'passwordHash=PH_SENTINEL temporaryPassword=TP_SENTINEL applicantAccessToken=AAT_SENTINEL tokenHash=TH_SENTINEL encryptedApiKey=EAK_SENTINEL proposedEncryptedApiKey=PEAK_SENTINEL cookie=CK_SENTINEL challengeHash=CH_SENTINEL providedHash=PRH_SENTINEL fingerprintHash=FPH_SENTINEL transferCode=TC_SENTINEL transferCodeHash=TCH_SENTINEL pin=PIN_SENTINEL safe=visible',
      );
      for (const sentinel of ['PH_SENTINEL', 'TP_SENTINEL', 'AAT_SENTINEL', 'TH_SENTINEL', 'EAK_SENTINEL', 'PEAK_SENTINEL', 'CK_SENTINEL', 'CH_SENTINEL', 'PRH_SENTINEL', 'FPH_SENTINEL', 'TC_SENTINEL', 'TCH_SENTINEL', 'PIN_SENTINEL']) {
        expect(out).not.toContain(sentinel);
      }
      expect(out).toContain('safe=visible');
      // snake_case spellings of the same secrets are now covered by normalization
      const snake = redactSensitiveText('api_key=SNAKE_SENTINEL_1 encrypted_api_key=SNAKE_SENTINEL_2');
      expect(snake).not.toContain('SNAKE_SENTINEL_1');
      expect(snake).not.toContain('SNAKE_SENTINEL_2');
    });

    it('does not create false positives on ordinary words containing key substrings', () => {
      const ordinary = 'statusCode=500 errorCode=PROVIDER_REJECTED_RETRYABLE tokenize(input) pinnedAt=2026-01-01 cookies=none';
      expect(redactSensitiveText(ordinary)).toBe(ordinary);
    });
  });

  describe('5. escaped quotes, backslashes and malformed JSON fail safe', () => {
    it('redacts complete quoted values containing escaped quotes and backslashes', () => {
      const input = `{"secret":"va\\"lue\\\\ESCAPE_SENTINEL_X","note":"keep me"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('ESCAPE_SENTINEL_X');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed.secret).toBe(REDACTED_VALUE);
      expect(parsed.note).toBe('keep me');
    });

    it('keeps surrounding escaped-quote structure parseable when an inner key=value is redacted', () => {
      const input = `{"note":"inner secret=INNER_SENTINEL_Y\\" tail","authorization":"Bearer AUTH_SENTINEL_Z"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('INNER_SENTINEL_Y');
      expect(out).not.toContain('AUTH_SENTINEL_Z');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed.authorization).toBe(REDACTED_VALUE);
      expect(String(parsed.note)).not.toContain('INNER_SENTINEL_Y');
    });

    it('fails safe on unbalanced quotes and malformed embedded JSON fragments', () => {
      const unbalanced = `Payload error: {"apiKey":"UNBALANCED_SENTINEL_Q`;
      const out1 = redactSensitiveText(unbalanced);
      expect(out1).not.toContain('UNBALANCED_SENTINEL_Q');
      expect(out1).toContain(REDACTED_VALUE);

      const fragment = `broken {"providerRef":"${BREVO} FRAGMENT_SENTINEL_R trailing`;
      const out2 = redactSensitiveText(fragment);
      expect(out2).not.toContain('FRAGMENT_SENTINEL_R');

      const dangling = `apiKey='DANGLING_SENTINEL_S`;
      expect(redactSensitiveText(dangling)).not.toContain('DANGLING_SENTINEL_S');
    });
  });

  describe('6. empty, null-like, malformed and extremely long values', () => {
    it('handles empty and null-like values without throwing or leaking', () => {
      expect(redactSensitiveText('apiKey=')).toBe(`apiKey=${REDACTED_VALUE}`);
      expect(redactSensitiveText('{"apiKey":""}')).toBe(`{"apiKey":"${REDACTED_VALUE}"}`);
      expect(redactSensitiveText('apiKey=null')).toBe(`apiKey=${REDACTED_VALUE}`);
      expect(redactSensitiveText('providerRef=')).toBe(`providerRef=${REDACTED_VALUE}`);
      expect(redactSensitiveText(`{"providerRef":""}`)).toBe(`{"providerRef":"${REDACTED_VALUE}"}`);
      expect(redactSensitiveText('token=undefined')).toBe(`token=${REDACTED_VALUE}`);
    });

    it('redacts malformed token shapes: bad scope, 31/33-hex and non-hex digests, wrong version', () => {
      const malformed = [
        `providerRef=pvr1:mailgun:${BREVO.slice('pvr1:brevo:'.length)}`,
        `providerRef=pvr1:brevo:${BREVO.slice('pvr1:brevo:'.length, -1)}`,
        `providerRef=${BREVO}0`,
        `providerRef=pvr1:brevo:${BREVO.slice('pvr1:brevo:'.length).replace('f', 'z')}`,
        `providerRef=pvr2:brevo:${BREVO.slice('pvr1:brevo:'.length)}`,
      ];
      for (const input of malformed) {
        const out = redactSensitiveText(input);
        expect(out).toBe(`providerRef=${REDACTED_VALUE}`);
      }
    });

    it('processes extremely long values and hostile runs linearly, redacting a terminal sentinel', () => {
      const longValue = 'x'.repeat(200_000);
      const started = Date.now();
      const out = redactSensitiveText(`apiKey=${longValue}LONG_VALUE_SENTINEL_END`);
      const elapsed = Date.now() - started;
      expect(out).not.toContain('LONG_VALUE_SENTINEL_END');
      expect(out).toBe(`apiKey=${REDACTED_VALUE}`);
      expect(elapsed).toBeLessThan(5000);

      const hostile = `robe_${'a'.repeat(500_000)} providerRef=${BREVO} tail`;
      const started2 = Date.now();
      const out2 = redactSensitiveText(hostile);
      expect(Date.now() - started2).toBeLessThan(5000);
      expect(out2).not.toContain(BREVO); // ambiguous whitespace suffix region fails safe
      expect(out2).toContain(REDACTED_VALUE);

      const manyPairs = Array.from({ length: 20_000 }, (_unused, i) => `token=TOK_${i}`).join(' ');
      const started3 = Date.now();
      const out3 = redactSensitiveText(manyPairs);
      expect(Date.now() - started3).toBeLessThan(5000);
      expect(out3).not.toContain('TOK_19999');
    });
  });

  describe('7. alternate separators and multiple sensitive values in one message', () => {
    it('handles =>, spaced colons and quoted separators', () => {
      expect(redactSensitiveText(`providerRef => ${BREVO} ARROW_SENTINEL_TX_NGN_1`)).not.toContain('ARROW_SENTINEL_TX_NGN_1');
      expect(redactSensitiveText(`providerRef : ${BREVO}`)).toBe(`providerRef : ${BREVO}`);
      expect(redactSensitiveText(`apiKey = "EQ_SECRET_SENTINEL"`)).toBe(`apiKey = "${REDACTED_VALUE}"`);
    });

    it('redacts multiple heterogeneous sensitive values in a single message', () => {
      const input = `Failure while testing: providerRef=${BREVO}:COLON_SENTINEL_A then {"providerRef":"${ROBASE} QUOTED_SPACE_SENTINEL_B","apiKey":"KEY_SENTINEL_C"} and password=PW_SENTINEL_D, token=TOK_SENTINEL_E`;
      const out = redactSensitiveText(input);
      for (const s of ['COLON_SENTINEL_A', 'QUOTED_SPACE_SENTINEL_B', 'KEY_SENTINEL_C', 'PW_SENTINEL_D', 'TOK_SENTINEL_E']) {
        expect(out).not.toContain(s);
      }
    });
  });

  describe('8. ordinary non-sensitive messages are preserved', () => {
    it('leaves plain prose and non-sensitive key=value text untouched', () => {
      const plain = 'Customer notification delivery delayed; retry scheduled for 2026-10-30T09:00:00Z (attempts=2, channel=SMS, status=PENDING)';
      expect(redactSensitiveText(plain)).toBe(plain);
      const mixed = `Delivery ${BREVO} recorded successfully`;
      expect(redactSensitiveText(mixed)).toBe(mixed); // bare token in prose is opaque and safe
    });
  });

  describe('9. F-01 historical protections remain intact', () => {
    it('still redacts legacy raw provider references and credential-shaped secrets', () => {
      const out = redactSensitiveText(
        'Delivery failed with providerRef=legacy-raw-token-9999 and provider_ref=unknown:secret123 plus xkeysib-CRED123456789 and re_CRED987654321 and robe_CRED111222333',
      );
      expect(out).toContain(`providerRef=${REDACTED_VALUE}`);
      expect(out).toContain(`provider_ref=${REDACTED_VALUE}`);
      expect(out).not.toContain('legacy-raw-token-9999');
      expect(out).not.toContain('secret123');
      expect(out).not.toContain('xkeysib-CRED123456789');
      expect(out).not.toContain('re_CRED987654321');
      expect(out).not.toContain('robe_CRED111222333');
    });
  });
});
