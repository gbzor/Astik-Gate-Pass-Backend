// Notification events for campus sticker applications.
// Formats branded email & SMS messages and dispatches them via the centralized notifications service.
// Never throws errors or interrupts HTTP requests.
import {
  ACTIVITY_TYPE,
  SMS_MAX_LENGTH,
  STICKER_STATUS,
} from '../config/constants.js';
import { users } from '../db/index.js';
import { dispatchEmail, dispatchSms } from './notifications.service.js';

// Escapes special characters to prevent HTML injection in email templates.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Formats a UTC ISO date string into Philippine / Manila time (UTC+8).
export function formatManilaDate(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Reusable responsive email layout with Ateneo de Naga University branding.
function emailLayout(title, contentHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; color: #2d3748;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <div style="background-color: #002147; padding: 24px; text-align: center;">
      <h1 style="margin: 0; color: #d4af37; font-size: 20px; letter-spacing: 0.5px;">Ateneo de Naga University</h1>
      <p style="margin: 6px 0 0 0; color: #ffffff; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Astik Gate Pass &bull; Campus Parking</p>
    </div>
    <div style="padding: 28px 24px;">
      ${contentHtml}
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #718096; text-align: center;">
      <p style="margin: 0 0 4px 0;">Ateneo de Naga University &bull; Security &amp; Safety Office</p>
      <p style="margin: 0;">This is an automated notification. Replies to this address are not monitored.</p>
    </div>
  </div>
</body>
</html>`;
}

// Notifies applicant when their sticker application is submitted (status: pending).
export async function notifyStickerSubmitted(application) {
  try {
    if (!application?.applicantId) return;
    const applicant = await users.findById(application.applicantId);
    if (!applicant?.email) return;

    const firstName = applicant.firstName || 'Applicant';
    const safeName = escapeHtml(firstName);
    const plate = application.vehicle?.plateNumber || 'N/A';
    const safePlate = escapeHtml(plate);

    const subject = 'Astik Gate Pass: Sticker Application Received';
    const text = `Hi ${firstName},\n\nYour campus parking sticker application for vehicle plate ${plate} has been received and is currently PENDING review by the Security Office.\n\nYou will receive another notification once your application is reviewed.\n\n- Ateneo de Naga University Security Office`;

    const html = emailLayout(
      'Application Received',
      `<h2 style="color: #002147; margin-top: 0;">Application Received</h2>
      <p>Hi ${safeName},</p>
      <p>Your campus parking sticker application has been received and is currently under review.</p>
      <div style="background-color: #f7fafc; border-left: 4px solid #002147; padding: 12px 16px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px;"><strong>Vehicle Plate:</strong> ${safePlate}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px;"><strong>Status:</strong> Pending Review</p>
      </div>
      <p style="font-size: 14px;">The Security &amp; Safety Office will review your application and vehicle details. You will be notified once reviewed.</p>`
    );

    const appId = application.id || 'unknown';
    await dispatchEmail({
      to: applicant.email,
      subject,
      text,
      html,
      deduplicationKey: `sticker-submitted:${appId}:email`,
      metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_SUBMITTED },
    });

    if (applicant.contactNumber) {
      const plateTag = plate !== 'N/A' ? ` (${plate})` : '';
      const message = `Astik Pass: Sticker app${plateTag} submitted and is pending review. Check your university email for details.`;
      await dispatchSms({
        to: applicant.contactNumber,
        message,
        deduplicationKey: `sticker-submitted:${appId}:sms`,
        metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_SUBMITTED },
      });
    }
  } catch (err) {
    console.error('[notify] Failed to send sticker submitted notification:', err.message);
  }
}

// Notifies applicant when their sticker application is approved (status: approved).
export async function notifyStickerApproved(application) {
  try {
    if (!application?.applicantId) return;
    const applicant = await users.findById(application.applicantId);
    if (!applicant?.email) return;

    const firstName = applicant.firstName || 'Applicant';
    const safeName = escapeHtml(firstName);
    const plate = application.vehicle?.plateNumber || 'N/A';
    const safePlate = escapeHtml(plate);
    const stickerNum = application.stickerNumber || 'N/A';
    const safeStickerNum = escapeHtml(stickerNum);
    const manilaExpiry = formatManilaDate(application.expiresAt);
    const safeExpiry = escapeHtml(manilaExpiry);

    const subject = 'Astik Gate Pass: Sticker Application Approved';
    const text = `Hi ${firstName},\n\nGreat news! Your campus parking sticker application for vehicle ${plate} has been APPROVED.\n\nSticker Number: ${stickerNum}\nValid Until: ${manilaExpiry} (Asia/Manila)\n\nPlease proceed to the Security & Safety Office to claim your physical sticker. Bring your valid Ateneo ID and vehicle OR/CR.\n\n- Ateneo de Naga University Security Office`;

    const html = emailLayout(
      'Application Approved',
      `<h2 style="color: #166534; margin-top: 0;">Application Approved</h2>
      <p>Hi ${safeName},</p>
      <p>Your campus parking sticker application has been <strong>approved</strong>!</p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 14px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #166534;"><strong>Vehicle Plate:</strong> ${safePlate}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #166534;"><strong>Sticker Number:</strong> ${safeStickerNum}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #166534;"><strong>Valid Until:</strong> ${safeExpiry}</p>
      </div>
      <h3 style="color: #002147; font-size: 15px; margin-bottom: 8px;">Claiming Instructions:</h3>
      <p style="margin: 0; font-size: 14px;">Please claim your parking sticker at the <strong>Security &amp; Safety Office</strong>. Present your valid Ateneo ID and vehicle registration documents (OR/CR).</p>`
    );

    const appId = application.id || STICKER_STATUS.APPROVED;
    await dispatchEmail({
      to: applicant.email,
      subject,
      text,
      html,
      deduplicationKey: `sticker-approved:${appId}:email`,
      metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_APPROVED },
    });

    if (applicant.contactNumber) {
      const plateTag = plate !== 'N/A' ? ` (${plate})` : '';
      const message = `Astik Pass: Sticker app${plateTag} is APPROVED! Sticker #${stickerNum}, valid until ${manilaExpiry}. Claim at Security Office.`;
      await dispatchSms({
        to: applicant.contactNumber,
        message,
        deduplicationKey: `sticker-approved:${appId}:sms`,
        metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_APPROVED },
      });
    }
  } catch (err) {
    console.error('[notify] Failed to send sticker approved notification:', err.message);
  }
}

// Notifies applicant when their sticker application is rejected (status: rejected).
export async function notifyStickerRejected(application) {
  try {
    if (!application?.applicantId) return;
    const applicant = await users.findById(application.applicantId);
    if (!applicant?.email) return;

    const firstName = applicant.firstName || 'Applicant';
    const safeName = escapeHtml(firstName);
    const plate = application.vehicle?.plateNumber || 'N/A';
    const safePlate = escapeHtml(plate);
    const reason = application.rejectionReason || 'Requirements incomplete or invalid.';
    const safeReason = escapeHtml(reason);

    const subject = 'Astik Gate Pass: Sticker Application Update';
    const text = `Hi ${firstName},\n\nYour campus parking sticker application for vehicle ${plate} was not approved.\n\nReason: ${reason}\n\nYou may submit a new application with updated documents or contact the Security Office for assistance.\n\n- Ateneo de Naga University Security Office`;

    const html = emailLayout(
      'Application Update',
      `<h2 style="color: #991b1b; margin-top: 0;">Application Status Update</h2>
      <p>Hi ${safeName},</p>
      <p>Your campus parking sticker application was not approved.</p>
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 14px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #991b1b;"><strong>Vehicle Plate:</strong> ${safePlate}</p>
        <p style="margin: 8px 0 0 0; font-size: 14px; color: #991b1b;"><strong>Reason:</strong> ${safeReason}</p>
      </div>
      <p style="font-size: 14px;">You may submit a new application with corrected documents or visit the Security &amp; Safety Office for inquiries.</p>`
    );

    const appId = application.id || STICKER_STATUS.REJECTED;
    await dispatchEmail({
      to: applicant.email,
      subject,
      text,
      html,
      deduplicationKey: `sticker-rejected:${appId}:email`,
      metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_REJECTED },
    });

    if (applicant.contactNumber) {
      const plateTag = plate !== 'N/A' ? ` (${plate})` : '';
      const maxReasonChars = 45;
      const shortReason = reason.length > maxReasonChars
        ? `${reason.slice(0, maxReasonChars - 3)}...`
        : reason;
      const message = `Astik Pass: Sticker app${plateTag} not approved. Reason: ${shortReason}. Check your AdNU email.`;
      await dispatchSms({
        to: applicant.contactNumber,
        message,
        deduplicationKey: `sticker-rejected:${appId}:sms`,
        metadata: { applicationId: appId, event: ACTIVITY_TYPE.STICKER_REJECTED },
      });
    }
  } catch (err) {
    console.error('[notify] Failed to send sticker rejected notification:', err.message);
  }
}

// Notifies applicant when their sticker is approaching expiration (e.g. 3 months or 1 month remaining).
export async function notifyStickerExpiring(application, monthsRemaining) {
  try {
    if (!application?.applicantId) return;
    const applicant = await users.findById(application.applicantId);
    if (!applicant?.email) return;

    const firstName = applicant.firstName || 'Applicant';
    const safeName = escapeHtml(firstName);
    const plate = application.vehicle?.plateNumber || 'N/A';
    const safePlate = escapeHtml(plate);
    const stickerNum = application.stickerNumber || 'N/A';
    const safeStickerNum = escapeHtml(stickerNum);
    const manilaExpiry = formatManilaDate(application.expiresAt);
    const safeExpiry = escapeHtml(manilaExpiry);

    const isUrgent = monthsRemaining === 1;
    const timeLabel = isUrgent ? '1 month' : `${monthsRemaining} months`;
    const urgencyPrefix = isUrgent ? 'URGENT: ' : '';

    const subject = `Astik Gate Pass: ${urgencyPrefix}Parking Sticker Renewal Reminder (${timeLabel} remaining)`;
    const text = isUrgent
      ? `Hi ${firstName},\n\nURGENT REMINDER: Your campus parking sticker for vehicle ${plate} (Sticker #${stickerNum}) will expire in 1 month on ${manilaExpiry} (Asia/Manila time).\n\nPlease submit your renewal application immediately through the Astik Gate Pass portal to avoid interruption of campus parking privileges.\n\n- Ateneo de Naga University Security Office`
      : `Hi ${firstName},\n\nThis is a friendly reminder that your campus parking sticker for vehicle ${plate} (Sticker #${stickerNum}) will expire in 3 months on ${manilaExpiry} (Asia/Manila time).\n\nYou may begin preparing your renewal requirements (valid Ateneo ID and updated OR/CR) and reapply on the portal before the expiration date.\n\n- Ateneo de Naga University Security Office`;

    const accentColor = isUrgent ? '#dc2626' : '#d97706';
    const boxBg = isUrgent ? '#fef2f2' : '#fffbeb';
    const boxBorder = isUrgent ? '#fecaca' : '#fde68a';
    const titleText = isUrgent ? 'Urgent Renewal Notice' : 'Sticker Renewal Reminder';

    const html = emailLayout(
      titleText,
      `<h2 style="color: ${accentColor}; margin-top: 0;">${titleText}</h2>
      <p>Hi ${safeName},</p>
      <p>Your campus parking sticker will expire in <strong>${timeLabel}</strong>.</p>
      <div style="background-color: ${boxBg}; border: 1px solid ${boxBorder}; border-radius: 6px; padding: 14px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: ${accentColor};"><strong>Vehicle Plate:</strong> ${safePlate}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: ${accentColor};"><strong>Sticker Number:</strong> ${safeStickerNum}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: ${accentColor};"><strong>Expiration Date:</strong> ${safeExpiry}</p>
      </div>
      <h3 style="color: #002147; font-size: 15px; margin-bottom: 8px;">Renewal Instructions:</h3>
      <p style="margin: 0; font-size: 14px;">${
        isUrgent
          ? 'Please log in to the <strong>Astik Gate Pass</strong> portal now to submit your renewal application. Unrenewed stickers will be subject to parking restrictions upon expiration.'
          : 'Please prepare your vehicle registration (OR/CR) and submit your renewal application on the <strong>Astik Gate Pass</strong> portal before your sticker expires.'
      }</p>`
    );

    const appId = application.id || 'expiring';
    await dispatchEmail({
      to: applicant.email,
      subject,
      text,
      html,
      deduplicationKey: `sticker-expiring:${appId}:${monthsRemaining}:email`,
      metadata: { applicationId: appId, event: 'sticker_expiring', monthsRemaining },
    });

    if (applicant.contactNumber) {
      const plateTag = plate !== 'N/A' ? ` (${plate})` : '';
      const message = isUrgent
        ? `Astik Pass: URGENT: Sticker${plateTag} expires in 1 mo on ${manilaExpiry}. Renew now on portal to maintain campus access.`
        : `Astik Pass: Sticker${plateTag} expires in 3 mos on ${manilaExpiry}. Please prepare renewal requirements on the portal.`;
      await dispatchSms({
        to: applicant.contactNumber,
        message,
        deduplicationKey: `sticker-expiring:${appId}:${monthsRemaining}:sms`,
        metadata: { applicationId: appId, event: 'sticker_expiring', monthsRemaining },
      });
    }
  } catch (err) {
    console.error('[notify] Failed to send sticker expiring notification:', err.message);
  }
}
