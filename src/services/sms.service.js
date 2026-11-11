// Sends SMS notifications. Switches between providers:
// - 'console' (default): prints to the terminal for free local development.
// - 'twilio': sends via Twilio trial/account.
// - 'android-gateway': sends via an Android phone gateway HTTP API.
import { env } from '../config/env.js';

// Masks Philippine mobile number for privacy logs (e.g. +639171234567 -> +63917****567).
export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 6)}****${phone.slice(-3)}`;
}

// Sends an SMS. Catch errors internally so failures never crash the app.
export async function sendSms({ to, message }) {
  if (!to) {
    console.warn('[sms] Skipped: recipient phone number is missing.');
    return { success: false, error: 'Recipient phone missing' };
  }

  // Verify Philippine mobile format (+639XXXXXXXXX).
  if (!/^\+639\d{9}$/.test(to)) {
    console.warn(`[sms] Skipped: invalid phone format '${maskPhone(to)}'. Expected +639XXXXXXXXX.`);
    return { success: false, error: 'Invalid phone format' };
  }

  const maskedTo = maskPhone(to);

  if (message.length > 160) {
    console.warn(`[sms] Warning: message to ${maskedTo} is ${message.length} chars (standard SMS limit is 160).`);
  }

  try {
    switch (env.sms.provider) {
      case 'console':
        console.log(`[sms:console] To: ${maskedTo} (${message.length}/160 chars)`);
        console.log(`[sms:console] Message: ${message}`);
        return { success: true, mode: 'console' };

      case 'twilio': {
        if (!env.sms.apiUrl || !env.sms.apiKey) {
          console.warn('[sms:twilio] Missing SMS_API_URL or SMS_API_KEY.');
          return { success: false, error: 'Twilio configuration missing' };
        }
        const res = await fetch(env.sms.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(env.sms.apiKey).toString('base64')}`,
          },
          body: new URLSearchParams({
            To: to,
            From: env.sms.from,
            Body: message,
          }),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Twilio HTTP ${res.status}: ${errorText}`);
        }
        console.log(`[sms:twilio] Sent SMS to ${maskedTo}`);
        return { success: true, mode: 'twilio' };
      }

      case 'android-gateway': {
        if (!env.sms.apiUrl) {
          console.warn('[sms:android-gateway] Missing SMS_API_URL.');
          return { success: false, error: 'Android gateway URL missing' };
        }
        const res = await fetch(env.sms.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.sms.apiKey && {
              Authorization: env.sms.apiKey,
              'x-api-key': env.sms.apiKey,
            }),
          },
          body: JSON.stringify({
            to,
            message,
          }),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Android gateway HTTP ${res.status}: ${errorText}`);
        }
        console.log(`[sms:android-gateway] Dispatched SMS to ${maskedTo}`);
        return { success: true, mode: 'android-gateway' };
      }

      default:
        console.warn(`[sms] Unknown SMS provider '${env.sms.provider}'.`);
        return { success: false, error: `Unknown provider: ${env.sms.provider}` };
    }
  } catch (err) {
    // Failures must never break the user's HTTP request.
    console.error(`[sms] Failed to send SMS to ${maskedTo}:`, err.message);
    return { success: false, error: err.message };
  }
}
