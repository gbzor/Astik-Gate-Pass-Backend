// Sends emails using Nodemailer via SMTP (e.g. Brevo or Gmail App Password).
// If SMTP_HOST is empty, it prints the email to the console for free local development.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

// Creates or returns the cached Nodemailer transporter.
function getTransporter() {
  if (!transporter && env.smtp.host) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user
        ? {
            user: env.smtp.user,
            pass: env.smtp.pass,
          }
        : undefined,
    });
  }
  return transporter;
}

// Masks email for privacy logs (e.g. juan@adnu.edu.ph -> j***@adnu.edu.ph).
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const initial = name.charAt(0) || '';
  return `${initial}***@${domain}`;
}

// Sends an email notification. Catch errors internally so failures never crash the app.
export async function sendEmail({ to, subject, text, html }) {
  if (!to) {
    console.warn('[email] Skipped: recipient email address is missing.');
    return { success: false, error: 'Recipient email missing' };
  }

  const maskedRecipient = maskEmail(to);

  // Free local development mode: prints to console if SMTP is not configured.
  if (!env.smtp.host) {
    console.log(`[email:console] To: ${maskedRecipient}`);
    console.log(`[email:console] Subject: ${subject}`);
    console.log(`[email:console] Text: ${text}`);
    if (html) {
      console.log(`[email:console] HTML preview: ${html.length} characters`);
    }
    return { success: true, mode: 'console' };
  }

  // Real SMTP delivery.
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: env.smtp.from,
      to,
      subject,
      text,
      html,
    });
    console.log(`[email] Sent message to ${maskedRecipient} (messageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    // Failures must never break the user's HTTP request.
    console.error(`[email] Failed to send email to ${maskedRecipient}:`, err.message);
    return { success: false, error: err.message };
  }
}
