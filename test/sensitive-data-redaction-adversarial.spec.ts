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

/**
 * Arena 4 report 15 (retest of d59689e) — five residual findings, permanent adversarial tests.
 * Reproductions (all FAILED on d59689e before the report-15 scanner rework):
 *  F1 unicode-escaped JSON keys; F2 unquoted multi-word authorization values;
 *  F3 key-less canonical token + whitespace suffix; F4 nested JSON-in-string truncation;
 *  F5 `code: 400` false positive.
 */
describe('redactSensitiveText — report-15 findings (escaped keys, headers, key-less refs, nested JSON, code fidelity)', () => {
  const BREVO = 'pvr1:brevo:fedcba9876543210fedcba9876543210';
  const ROBASE = 'pvr1:robase:0123456789abcdef0123456789abcdef';

  describe('F1 — JSON unicode-escaped sensitive property names', () => {
    it('redacts values under unicode-escaped apiKey/authorization/secret/token keys in valid JSON', () => {
      const input = `{"api\\u004Bey":"UNICODE_KEY_SECRET_SENTINEL"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('UNICODE_KEY_SECRET_SENTINEL');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed.apiKey).toBe(REDACTED_VALUE);

      const mixed = `{"auth\\u006frization":"UNICODE_AUTH_SENTINEL","\\u0073ecret":"UNICODE_SECRET_SENTINEL","token":"UNICODE_TOKEN_SENTINEL"}`;
      const outMixed = redactSensitiveText(mixed);
      for (const s of ['UNICODE_AUTH_SENTINEL', 'UNICODE_SECRET_SENTINEL', 'UNICODE_TOKEN_SENTINEL']) {
        expect(outMixed).not.toContain(s);
      }
      const parsedMixed = JSON.parse(outMixed) as Record<string, unknown>;
      expect(parsedMixed.authorization).toBe(REDACTED_VALUE);
      expect(parsedMixed.secret).toBe(REDACTED_VALUE);
      expect(parsedMixed.token).toBe(REDACTED_VALUE);
    });

    it('redacts an escaped providerRef key whose value carries a whitespace suffix', () => {
      const input = `{"provider\\u0052ef":"${BREVO} SUFFIX_SENTINEL"}`;
      const out = redactSensitiveText(input);
      expect(out).not.toContain('SUFFIX_SENTINEL');
      expect(out).not.toContain(BREVO);
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed.providerRef).toBe(REDACTED_VALUE);
    });

    it('preserves an escaped providerRef key whose complete value is a canonical token', () => {
      const input = `{"provider\\u0052ef":"${ROBASE}"}`;
      const out = redactSensitiveText(input);
      expect(JSON.parse(out)).toEqual({ providerRef: ROBASE });
    });

    it('fails safe on malformed (unbalanced) text containing escaped key spellings', () => {
      const unbalanced = `{"api\\u004Bey":"UNICODE_MALFORMED_SENTINEL"`;
      const out = redactSensitiveText(unbalanced);
      expect(out).not.toContain('UNICODE_MALFORMED_SENTINEL');
      expect(out).toContain(REDACTED_VALUE);

      const bareEscapes = `\\u0061\\u0070\\u0069\\u004B\\u0065\\u0079=FULLY_ESCAPED_KEY_SENTINEL`;
      const outBare = redactSensitiveText(bareEscapes);
      expect(outBare).not.toContain('FULLY_ESCAPED_KEY_SENTINEL');
    });
  });

  describe('F2 — unquoted multi-word authorization/header values', () => {
    it('redacts the complete Bearer/Basic credential region, not just the scheme word', () => {
      expect(redactSensitiveText('authorization: Bearer BEARER_SECRET_SENTINEL')).toBe(
        `authorization: ${REDACTED_VALUE}`,
      );
      expect(redactSensitiveText('Authorization: Basic BASIC_CRED_SENTINEL_123')).toBe(
        `Authorization: ${REDACTED_VALUE}`,
      );
      expect(redactSensitiveText('AUTHORIZATION = BEARER UPPER_CRED_SENTINEL')).toBe(
        `AUTHORIZATION = ${REDACTED_VALUE}`,
      );
      // Region extension consumes sentinel-shaped runs but stops before ordinary prose
      // ("confirm ordinary error text is not unnecessarily destroyed" — report 15).
      expect(redactSensitiveText('x-api-key: XAPI_SECRET_SENTINEL tail')).toBe(
        `x-api-key: ${REDACTED_VALUE} tail`,
      );
    });

    it('consumes multi-run unquoted values for generic sensitive keys up to a safe delimiter', () => {
      expect(redactSensitiveText('apiKey=SECRET_PART_ONE SECRET_PART_TWO')).toBe(`apiKey=${REDACTED_VALUE}`);
      // A following key=value pair or hard delimiter stops the region (diagnostics preserved).
      expect(redactSensitiveText('token=TOK_A TOK_B, status=FAILED')).toBe(
        `token=${REDACTED_VALUE}, status=FAILED`,
      );
      // Newline terminates header-style values.
      expect(redactSensitiveText('authorization: Bearer MULTI_LINE_CRED\nrequestId=req-1')).toBe(
        `authorization: ${REDACTED_VALUE}\nrequestId=req-1`,
      );
    });
  });

  describe('F3 — key-less canonical provider reference with whitespace/newline suffix', () => {
    it('fails safe when a sentinel-shaped run follows a bare canonical token', () => {
      const out = redactSensitiveText(`Opaque reference ${BREVO} KEYLESS_SPACE_SENTINEL`);
      expect(out).not.toContain('KEYLESS_SPACE_SENTINEL');
      expect(out).not.toContain(BREVO);
      expect(out).toBe(`Opaque reference ${REDACTED_VALUE}`);

      const outNl = redactSensitiveText(`Opaque reference ${BREVO}\nKEYLESS_NEWLINE_SENTINEL`);
      expect(outNl).not.toContain('KEYLESS_NEWLINE_SENTINEL');

      const outJson = redactSensitiveText(`{"msg":"ref ${BREVO} KEYLESS_JSON_SENTINEL tail"}`);
      expect(outJson).not.toContain('KEYLESS_JSON_SENTINEL');
      expect(JSON.parse(outJson).msg).toContain(REDACTED_VALUE);
    });

    it('preserves bare canonical tokens surrounded by ordinary prose (no indiscriminate destruction)', () => {
      expect(redactSensitiveText(`Opaque reference ${BREVO} recorded successfully`)).toBe(
        `Opaque reference ${BREVO} recorded successfully`,
      );
      expect(redactSensitiveText(`Delivery ${ROBASE} completed at 2026-10-30T09:00:00Z`)).toBe(
        `Delivery ${ROBASE} completed at 2026-10-30T09:00:00Z`,
      );
    });
  });

  describe('F4 — nested JSON-in-a-string keeps complete non-sensitive structure', () => {
    it('redacts a stringified inner JSON secret while preserving sibling fields and outer validity', () => {
      const input = JSON.stringify({
        message: JSON.stringify({ apiKey: 'EMBED_SECRET_SENTINEL', next: 'PRESERVE_ME' }),
        requestId: 'req-42',
      });
      const out = redactSensitiveText(input);
      expect(out).not.toContain('EMBED_SECRET_SENTINEL');
      const outer = JSON.parse(out) as { message: string; requestId: string };
      expect(outer.requestId).toBe('req-42');
      const inner = JSON.parse(outer.message) as Record<string, unknown>;
      expect(inner.apiKey).toBe(REDACTED_VALUE);
      expect(inner.next).toBe('PRESERVE_ME');
    });

    it('preserves trailing message text after an embedded stringified object', () => {
      const input = JSON.stringify({
        message: `${JSON.stringify({ token: 'EMBED_TOK_SENTINEL' })} trailing diagnostic text`,
      });
      const out = redactSensitiveText(input);
      expect(out).not.toContain('EMBED_TOK_SENTINEL');
      const outer = JSON.parse(out) as { message: string };
      expect(outer.message).toContain('trailing diagnostic text');
      expect(outer.message).toContain(REDACTED_VALUE);
    });

    it('handles three nesting levels and preserves canonical refs inside stringified JSON', () => {
      const input = JSON.stringify({
        a: JSON.stringify({ b: JSON.stringify({ secret: 'DEEP_SECRET_SENTINEL', keep: 'DEEP_KEEP' }) }),
      });
      const out = redactSensitiveText(input);
      expect(out).not.toContain('DEEP_SECRET_SENTINEL');
      const l1 = JSON.parse(out) as { a: string };
      const l2 = JSON.parse(l1.a) as { b: string };
      const l3 = JSON.parse(l2.b) as Record<string, unknown>;
      expect(l3.secret).toBe(REDACTED_VALUE);
      expect(l3.keep).toBe('DEEP_KEEP');

      const withRef = JSON.stringify({ m: JSON.stringify({ providerRef: ROBASE, note: 'ok' }) });
      const outRef = redactSensitiveText(withRef);
      const m1 = JSON.parse(outRef) as { m: string };
      const m2 = JSON.parse(m1.m) as Record<string, unknown>;
      expect(m2.providerRef).toBe(ROBASE);
      expect(m2.note).toBe('ok');
    });
  });

  describe('F5 — ordinary diagnostic metadata stays readable', () => {
    it('does not redact bare code/statusCode/errorCode prose or JSON fields', () => {
      expect(redactSensitiveText('The code: 400 was expected')).toBe('The code: 400 was expected');
      expect(redactSensitiveText('error code: BAD_REQUEST')).toBe('error code: BAD_REQUEST');
      const body = `{"statusCode":500,"code":"INTERNAL_SERVER_ERROR","message":"boom","errorCode":"E_42"}`;
      expect(redactSensitiveText(body)).toBe(body);
    });

    it('keeps genuinely sensitive code-family keys redacted', () => {
      expect(redactSensitiveText('codeHash=CODEHASH_SENTINEL')).toBe(`codeHash=${REDACTED_VALUE}`);
      expect(redactSensitiveText('recoveryCode=RECOVERY_SENTINEL')).toBe(`recoveryCode=${REDACTED_VALUE}`);
      expect(redactSensitiveText('transferCode=TRANSFER_SENTINEL')).toBe(`transferCode=${REDACTED_VALUE}`);
      expect(redactSensitiveText('{"challengeHash":"CHALLENGE_SENTINEL"}')).toBe(
        `{"challengeHash":"${REDACTED_VALUE}"}`,
      );
    });
  });
});
