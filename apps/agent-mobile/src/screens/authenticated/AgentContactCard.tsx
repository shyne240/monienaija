import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ApiClient } from '../../services/api-client';
import { theme } from '../../theme';

type Contact = { registeredPhone: string | null; verifiedAt: string | null; smsEnabled: boolean };

/** OTP and its short-lived verification token remain in memory and are never logged or persisted. */
export const AgentContactCard: React.FC = () => {
  const [contact, setContact] = React.useState<Contact | null>(null);
  const [phone, setPhone] = React.useState('');
  const [requestedPhone, setRequestedPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const inFlight = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    ApiClient.get<Contact>('api/v1/agents/me/contact').then(
      (result) => {
        if (alive) setContact(result);
      },
      () => {
        if (alive) setMessage('Contact information is unavailable. Try again later.');
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const requestCode = async () => {
    if (inFlight.current || !phone.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    setCode('');
    setRequestedPhone('');
    try {
      const requested = phone.trim();
      await ApiClient.post('api/v1/customers/registration/otp', { phone: requested });
      setRequestedPhone(requested);
      setMessage('If this number can be verified, a code may arrive.');
    } catch {
      setMessage('Could not request a code. Try again later.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const verifyCode = async () => {
    if (inFlight.current || !requestedPhone || !/^\d{6}$/.test(code)) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const proof = await ApiClient.post<{ verificationToken: string }>(
        'api/v1/customers/registration/otp/verify',
        { phone: requestedPhone, code },
      );
      setCode('');
      const updated = await ApiClient.post<Contact>('api/v1/agents/me/contact/phone', {
        phone: requestedPhone,
        verificationToken: proof.verificationToken,
      });
      setContact(updated);
      setRequestedPhone('');
      setPhone('');
      setMessage('Registered phone verified.');
    } catch {
      setCode('');
      setRequestedPhone('');
      setMessage('Verification could not be completed. Request a new code or contact support.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const preference = async (smsEnabled: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      setContact(
        await ApiClient.patch<Contact>('api/v1/agents/me/contact/notification-preferences', {
          smsEnabled,
        }),
      );
    } catch {
      setMessage('Could not update SMS preference.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Card style={styles.card} testID="agent-contact-card">
      <Text style={styles.title}>Registered phone</Text>
      <Text>
        {contact?.registeredPhone
          ? `Verified: ${contact.registeredPhone}`
          : 'No verified registered phone.'}
      </Text>
      <Text>
        A receiving number is not a verified phone. Verify a phone you control to receive eligible
        notifications.
      </Text>
      <TextInput
        testID="agent-contact-phone"
        value={phone}
        keyboardType="phone-pad"
        editable={!busy}
        placeholder="Nigerian phone number"
        onChangeText={(value) => {
          setPhone(value);
          setRequestedPhone('');
          setCode('');
        }}
        style={styles.input}
      />
      <Button label="Request verification code" onPress={requestCode} loading={busy} />
      {!!requestedPhone && (
        <>
          <Text>Enter the code for {requestedPhone}.</Text>
          <TextInput
            testID="agent-contact-code"
            value={code}
            keyboardType="number-pad"
            editable={!busy}
            secureTextEntry
            maxLength={6}
            placeholder="Six-digit code"
            onChangeText={setCode}
            style={styles.input}
          />
          <Button label="Verify phone" onPress={verifyCode} loading={busy} />
        </>
      )}
      {contact?.registeredPhone && (
        <>
          <Text>SMS notifications: {contact.smsEnabled ? 'Enabled' : 'Disabled'}</Text>
          <Button
            variant="outline"
            label={contact.smsEnabled ? 'Disable SMS notifications' : 'Enable SMS notifications'}
            onPress={() => preference(!contact.smsEnabled)}
            loading={busy}
          />
        </>
      )}
      {!!message && <Text testID="agent-contact-message">{message}</Text>}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600', color: theme.colors.neutral.charcoal },
  input: { borderWidth: 1, borderColor: '#aaa', borderRadius: 8, padding: 10, marginVertical: 8 },
});
