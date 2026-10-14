import nodemailer, { type Transporter } from 'nodemailer';

interface SendOtpOptions {
  toEmail: string;
  otp: string;
  displayName?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || 587);

  if (!host || !user || !pass) {
    console.warn('[EmailService] SMTP credentials are not fully configured. Emails will be logged to console in mock mode.');
    return null;
  }

  if (!transporter) {
    const isSecure = port === 465;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  return transporter;
}

export function generateOtp(): string {
  // Generate a cryptographically sound or standard 6-digit numeric OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationOtpEmail({ toEmail, otp, displayName }: SendOtpOptions): Promise<boolean> {
  const mailTransporter = getTransporter();
  const fromAddress = process.env.SMTP_USER?.trim() || 'noreply@studymate.ai';
  const senderName = 'StudyMate AI';
  const recipientName = displayName?.trim() || 'Student';

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your StudyMate AI Verification Code</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #E2E8F0;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #0F172A;
      padding: 40px 16px;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #1E293B;
      border-radius: 20px;
      border: 1px solid #334155;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3);
    }
    .header-banner {
      background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 50%, #9333EA 100%);
      padding: 36px 24px;
      text-align: center;
    }
    .brand-icon {
      display: inline-block;
      width: 48px;
      height: 48px;
      line-height: 48px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 14px;
      font-size: 24px;
      margin-bottom: 12px;
    }
    .brand-title {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
    }
    .content-area {
      padding: 36px 28px;
      text-align: center;
    }
    .greeting {
      font-size: 19px;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 12px;
      text-align: left;
    }
    .paragraph {
      font-size: 15px;
      line-height: 24px;
      color: #94A3B8;
      margin: 0 0 24px 0;
      text-align: left;
    }
    .otp-card {
      background: #0F172A;
      border: 2px dashed #6366F1;
      border-radius: 16px;
      padding: 24px 16px;
      margin: 28px 0;
      text-align: center;
    }
    .otp-label {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #818CF8;
      margin-bottom: 8px;
    }
    .otp-number {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #FFFFFF;
      margin: 0;
      text-indent: 8px;
    }
    .expiry-note {
      font-size: 13px;
      color: #A5B4FC;
      margin-top: 10px;
    }
    .security-notice {
      background: rgba(99, 102, 241, 0.08);
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 13px;
      line-height: 20px;
      color: #CBD5E1;
      text-align: left;
      margin-bottom: 24px;
    }
    .footer-area {
      border-top: 1px solid #334155;
      padding: 24px 28px;
      text-align: center;
      background-color: #172033;
    }
    .footer-text {
      font-size: 12px;
      line-height: 18px;
      color: #64748B;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header-banner">
        <div class="brand-icon">✨</div>
        <h1 class="brand-title">StudyMate AI</h1>
      </div>
      <div class="content-area">
        <div class="greeting">Hi ${recipientName},</div>
        <p class="paragraph">
          Thank you for joining StudyMate AI, your intelligent study companion. To complete your registration and activate your account, please verify your email address using the one-time password (OTP) below:
        </p>
        <div class="otp-card">
          <div class="otp-label">Verification Code</div>
          <div class="otp-number">${otp}</div>
          <div class="expiry-note">⏱️ Expires in 10 minutes</div>
        </div>
        <div class="security-notice">
          🔒 <strong>Security Tip:</strong> Never share this verification code with anyone. StudyMate AI will never ask for your code or password via phone or message.
        </div>
        <p class="paragraph" style="margin-bottom: 0; font-size: 13px; color: #64748B;">
          If you did not sign up for a StudyMate AI account, please ignore this email.
        </p>
      </div>
      <div class="footer-area">
        <p class="footer-text">
          © ${new Date().getFullYear()} StudyMate AI. All rights reserved.<br>
          Designed to help you master any subject with AI.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
StudyMate AI - Email Verification

Hi ${recipientName},

Thank you for joining StudyMate AI. Your 6-digit verification code is:

${otp}

This code will expire in 10 minutes.

Security Tip: Never share this code with anyone. StudyMate AI will never ask for your code.
If you did not create an account with StudyMate AI, please ignore this message.
`;

  if (!mailTransporter) {
    console.log(`\n========================================`);
    console.log(`[MOCK EMAIL SENT]`);
    console.log(`To: ${toEmail}`);
    console.log(`Subject: StudyMate AI - Verification Code: ${otp}`);
    console.log(`OTP: ${otp}`);
    console.log(`========================================\n`);
    return true;
  }

  try {
    const info = await mailTransporter.sendMail({
      from: `"${senderName}" <${fromAddress}>`,
      to: toEmail,
      subject: `${otp} is your StudyMate AI verification code`,
      text: textContent,
      html: htmlContent,
    });
    console.log(`[EmailService] Verification OTP sent to ${toEmail}. MessageId: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[EmailService] Failed to send verification email to ${toEmail}:`, err);
    throw err;
  }
}
