import 'dotenv/config'
import { sendEmail } from '../email/smtp.js'

const args = parseArgs(process.argv.slice(2))
const to = String(args.to || process.env.TEST_EMAIL_TO || '').trim()
const subject = args.subject || 'Opportunity Radar - test SMTP'
const text = args.text || [
  'Message test Opportunity Radar.',
  '',
  `Envoye depuis ${process.env.NODE_ENV || 'unknown'} le ${new Date().toISOString()}.`,
].join('\n')

try {
  if (!to) throw new Error('Destinataire manquant. Utiliser --to ou TEST_EMAIL_TO.')
  const result = await sendEmail({ to, subject, text })
  console.log(`[email:test] message envoye a ${to}`)
  console.log(`[email:test] messageId: ${result.messageId || 'non fourni'}`)
} catch (error) {
  console.error(`[email:test] echec: ${error.message}`)
  process.exitCode = 1
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue

    const [rawKey, inlineValue] = arg.slice(2).split('=')
    const key = rawKey.trim()
    const value = inlineValue ?? argv[index + 1]
    if (inlineValue === undefined) index += 1
    parsed[key] = value
  }
  return parsed
}
