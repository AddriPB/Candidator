import nodemailer from 'nodemailer'

const REQUIRED_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'APPLICATION_FROM']

export function assertSmtpConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || env[key] === 'XXXXXXXX')
  if (missing.length) {
    throw new Error(`Configuration SMTP incomplete: ${missing.join(', ')}`)
  }
}

export function createSmtpTransport(env = process.env) {
  assertSmtpConfig(env)

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE === 'true',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD.replace(/\s+/g, ''),
    },
  })
}

export async function sendEmail({ to, subject, text, html, attachments = [] }, env = process.env) {
  if (!to) throw new Error('Destinataire manquant.')
  if (!subject) throw new Error('Objet manquant.')
  if (!text && !html) throw new Error('Message manquant.')

  const transport = createSmtpTransport(env)
  return transport.sendMail({
    from: env.APPLICATION_FROM,
    to,
    subject,
    text,
    html,
    attachments,
  })
}
