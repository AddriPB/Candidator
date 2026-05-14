import 'dotenv/config'
import {
  fetchBounceMessagesFromImap,
  processApplicationBounces,
  readBounceMessagesFromDirectory,
} from '../applications/bounces.js'
import { openDatabase } from '../storage/database.js'

const db = openDatabase()

try {
  const directoryMessages = readBounceMessagesFromDirectory(process.env.APPLICATION_EMAIL_BOUNCE_DIR)
  const imapMessages = await fetchBounceMessagesFromImap(process.env)
  const summary = await processApplicationBounces({
    db,
    messages: [...directoryMessages, ...imapMessages],
  })
  console.log(`[applications] parsed: ${summary.parsed}`)
  console.log(`[applications] hard bounced: ${summary.hardBounced}`)
  console.log(`[applications] soft bounced: ${summary.softBounced}`)
  console.log(`[applications] accepted after grace: ${summary.accepted}`)
} catch (error) {
  console.error(`[applications] bounce processing failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
